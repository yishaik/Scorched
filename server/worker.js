// Scorched Tanks multiplayer relay — Cloudflare Worker + Durable Objects
// Routes:
//   GET  /health
//   POST /api/room            {public?:bool, max?:2-6}  -> {code, max}     (rate limited per IP; 429 + retry-after)
//   GET  /api/room/:code       -> room info
//   WS   /ws/quick?name=&pid=&ver=&proto=          -> Lobby (matchmaking); server replies {t:"matched", code}
//   WS   /ws/room/:code?name=&pid=&ver=&proto=&tok= -> Room relay
//
// Protocol revision (PROTO) is separate from the app version (APP_VER):
//   proto 1 = v1.15 and older clients (they send no proto param). proto 2 = rejoin tokens, host-set room size.
//   The server accepts PROTO_MIN..any; a client below PROTO_MIN gets {t:"err", code:"upgrade"} and close 4026.
//   PROTO_MIN is 1, so v1.15 clients keep working. Version/proto differences inside a room only WARN (client side).
//
// Seat ownership (rejoin tokens):
//   The first join of a seat gets a secret `tok` in its own hello only (never in the roster, never in invite URLs).
//   Taking over an existing seat (same pid) needs that tok. A seat first taken by a proto-1 client (no tokens) may
//   be taken over without a tok only when its socket is closed or silent for STALE_MS; a live one is refused (close 4003).
//
// Room protocol (JSON):
//   c->s {t:"start"} host | {t:"relay", d, to?} | {t:"snap", d} host | {t:"public", v} host | {t:"kick", pid} host
//        {t:"max", v:2-6} host, lobby only (proto 2) | {t:"end"} host | {t:"ping"}
//   s->c {t:"hello", pid, code, tok, proto, minProto} | {t:"roster", code, host, status, public, max, proto, minProto, players:[{pid,name,seat,ver,proto,on}]}
//        {t:"msg", from, d} | {t:"host", pid, snap} (host migration) | {t:"err", m, code?} | {t:"pong"}
// Relay rules (enforced here): d must be an object with a string k. Host-only kinds: cfg, begin, state, shopOpen, shopReady.
//   k "shop" must carry the sender's own pid. k "rejoin" is server-only. `to` must name a connected pid.
//   Size caps: host frames <= 2,000,000 chars, everyone else <= 32,768. Per-socket rate: burst 60, 30 msgs/s.
// Close codes: 4001 kicked, 4003 seat owned by another socket/token, 4004 no room, 4008 full, 4009 started,
//   4026 protocol too old, 4029 rate limited.

import LANDING from "./landing.txt";
import GAME from "./game.txt";
import APK from "./app.apk.bin";
const APP_VER = "1.16";
const PROTO = 2;
const PROTO_MIN = 1;
export const LIMITS = {
  hostFrame: 2_000_000, // chars: a full state with terrain runs
  peerFrame: 32_768, // chars: aim, fire, move, shop, needState
  kindMax: { begin: 65_536, cfg: 65_536, shopOpen: 4096, shopReady: 8192 },
  burst: 60, perSec: 30, dropClose: 300, // per socket message bucket; close after this many drops
  staleMs: 30_000, // a socket silent this long (pings come every 20s) counts as gone for legacy takeover
  roomPerMin: 10, roomPerHour: 60, // POST /api/room per IP
  wsPerMin: 30, // WebSocket upgrades per IP per room / for the lobby
  bodyMax: 1024, // POST /api/room body chars
  minSeats: 2, maxSeats: 6,
};
const HOST_KINDS = new Set(["cfg", "begin", "state", "shopOpen", "shopReady"]);
const ORIGINS = ["https://tanks.yishaik.com", "https://scorched-tanks.yishai-k.workers.dev", "null"]; // "null" = Android WebView file:///android_asset
const ALPH = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const newCode = () => Array.from({ length: 4 }, () => ALPH[Math.floor(Math.random() * ALPH.length)]).join("");
const clean = (s, n = 16) => String(s || "").replace(/[^\p{L}\p{N} _.-]/gu, "").trim().slice(0, n) || "Player";
const rid = () => crypto.randomUUID().slice(0, 8);
const newTok = () => { const a = new Uint8Array(16); crypto.getRandomValues(a); return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join(""); };
const json = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", ...h } });
const ws101 = (client) => new Response(null, { status: 101, webSocket: client });
const cleanPid = (v) => { const s = String(v || ""); return /^[\w-]{1,64}$/.test(s) && s !== "server" ? s.slice(0, 40) : rid(); };
const parseProto = (v) => { const n = parseInt(v, 10); return n >= 1 && n <= 999 ? n : 1; };
const clampSeats = (v) => Math.min(LIMITS.maxSeats, Math.max(LIMITS.minSeats, v | 0 || 4));
const ipOf = (req) => req.headers.get("CF-Connecting-IP") || req.headers.get("X-Forwarded-For") || "?";
const isObj = (o) => !!o && typeof o === "object" && !Array.isArray(o);
function safeEq(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
// CORS: echo an allowed Origin. No Origin (native/curl) needs no header. env.CORS_ANY="1" restores "*".
export function corsFor(req, env) {
  const base = { "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "content-type", Vary: "Origin" };
  if (env && env.CORS_ANY === "1") return { ...base, "Access-Control-Allow-Origin": "*" };
  const o = req.headers.get("Origin");
  if (!o) return base;
  const extra = String((env && env.ALLOWED_ORIGINS) || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = ORIGINS.includes(o) || extra.includes(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
  return ok ? { ...base, "Access-Control-Allow-Origin": o } : base;
}
// fixed-window counter per key
export class Window {
  constructor(limit, ms) { this.limit = limit; this.ms = ms; this.m = new Map(); }
  // 0 = allowed, else seconds until the window resets
  hit(key, now = Date.now()) {
    let e = this.m.get(key);
    if (!e || now - e.t >= this.ms) {
      if (this.m.size > 5000) for (const [k, x] of this.m) if (now - x.t >= this.ms) this.m.delete(k);
      e = { t: now, n: 0 }; this.m.set(key, e);
    }
    e.n++;
    return e.n <= this.limit ? 0 : Math.max(1, Math.ceil((e.t + this.ms - now) / 1000));
  }
}
export class Bucket {
  constructor(cap, perSec) { this.cap = cap; this.r = perSec; this.n = cap; this.t = Date.now(); }
  take(now = Date.now()) {
    this.n = Math.min(this.cap, this.n + ((now - this.t) / 1000) * this.r); this.t = now;
    if (this.n < 1) return false;
    this.n -= 1; return true;
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;
    const cors = corsFor(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (p === "/health") return json({ ok: true, game: "scorched-tanks", v: 2, app: APP_VER, proto: PROTO, minProto: PROTO_MIN }, 200, { "Access-Control-Allow-Origin": "*" });
    const html = (b) => new Response(b, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
    if (p === "/" || /^\/join\/[A-Za-z]{4}\/?$/.test(p)) return html(LANDING);
    if (p === "/play" || p === "/play/") return html(GAME);
    if (p === "/hark.js") return new Response("", { headers: { "content-type": "application/javascript" } });
    if (p === "/download" || p === "/ScorchedTanks.apk") return new Response(APK, { headers: { "content-type": "application/vnd.android.package-archive", "content-disposition": 'attachment; filename="ScorchedTanks-' + APP_VER + '.apk"', "cache-control": "no-cache" } });
    if (p === "/.well-known/assetlinks.json") return json([{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: "com.yishai.scorchedtanks", sha256_cert_fingerprints: ["0B:23:9E:D6:B6:E3:C7:4F:05:EC:3B:C6:E4:6A:66:D9:3D:EB:77:9B:62:D8:01:46:89:9E:93:0C:BB:7F:6D:98"] } }]);
    const lobby = () => env.LOBBY.get(env.LOBBY.idFromName("main"));
    if (p === "/api/room" && req.method === "POST") {
      // per-IP quota, kept in the Lobby DO so it holds across Worker isolates
      const rl = await lobby().fetch("https://do/rl", { method: "POST", body: JSON.stringify({ ip: ipOf(req), k: "room" }) }).then((r) => r.json()).catch(() => ({ ok: true }));
      if (!rl.ok) return json({ error: "rate limited", retry: rl.retry }, 429, { ...cors, "retry-after": String(rl.retry || 60) });
      const len = +req.headers.get("content-length") || 0;
      if (len > LIMITS.bodyMax) return json({ error: "too large" }, 413, cors);
      const txt = await req.text().catch(() => "");
      if (txt.length > LIMITS.bodyMax) return json({ error: "too large" }, 413, cors);
      let body = {}; try { body = JSON.parse(txt || "{}"); } catch (x) {}
      if (!isObj(body)) body = {};
      const max = clampSeats(body.max);
      for (let i = 0; i < 8; i++) {
        const code = newCode();
        const stub = env.ROOM.get(env.ROOM.idFromName(code));
        const r = await stub.fetch("https://do/init", { method: "POST", body: JSON.stringify({ code, public: !!body.public, max }) }).catch(() => null);
        if (r && r.status === 200) return json({ code, max }, 200, cors);
      }
      return json({ error: "busy" }, 503, cors);
    }
    let m = p.match(/^\/api\/room\/([A-Z]{4})$/);
    if (m) {
      const r = await env.ROOM.get(env.ROOM.idFromName(m[1])).fetch("https://do/info");
      return json(await r.json(), r.status, cors);
    }
    if (p === "/ws/quick") return lobby().fetch(req);
    m = p.match(/^\/ws\/room\/([A-Za-z]{4})$/);
    if (m) {
      const code = m[1].toUpperCase();
      return env.ROOM.get(env.ROOM.idFromName(code)).fetch(new Request("https://do/ws?" + url.searchParams + "&code=" + code, req));
    }
    return json({ error: "not found" }, 404, cors);
  },
};

// ---------- Lobby: matchmaking queue + list of open public rooms + per-IP quotas ----------
export class Lobby {
  constructor(state, env) {
    this.env = env;
    this.queue = []; // {ws, name, pid, t, gone}
    this.rooms = new Map(); // code -> {free, ts}
    this.timer = null; this.retryT = null;
    this.launching = false; this.fails = 0;
    this.rlMin = new Window(LIMITS.roomPerMin, 60_000);
    this.rlHour = new Window(LIMITS.roomPerHour, 3_600_000);
    this.wsRate = new Window(LIMITS.wsPerMin, 60_000);
  }
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/rl") {
      const d = await req.json().catch(() => ({}));
      const key = String(d.ip || "?");
      const a = this.rlMin.hit(key), b = a ? 0 : this.rlHour.hit(key);
      if (a || b) { console.log("rate-limit room-create"); return json({ ok: false, retry: a || b }); }
      return json({ ok: true });
    }
    if (url.pathname === "/room-update") {
      const d = await req.json();
      if (!d.public || d.status !== "lobby" || d.free <= 0) this.rooms.delete(d.code);
      else this.rooms.set(d.code, { free: d.free, ts: Date.now() });
      return json({ ok: true });
    }
    if (req.headers.get("Upgrade") !== "websocket") return json({ error: "ws only" }, 426);
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const proto = parseProto(url.searchParams.get("proto"));
    if (proto < PROTO_MIN) {
      server.send(JSON.stringify({ t: "err", code: "upgrade", m: "Please update Scorched Tanks to play online", proto: PROTO, minProto: PROTO_MIN }));
      server.close(4026, "upgrade"); return ws101(client);
    }
    if (this.wsRate.hit(ipOf(req))) {
      server.send(JSON.stringify({ t: "err", code: "rate", m: "Too many connections, wait a minute" }));
      server.close(4029, "rate"); return ws101(client);
    }
    const entry = { ws: server, name: clean(url.searchParams.get("name")), pid: cleanPid(url.searchParams.get("pid")), t: Date.now(), proto, gone: false, bucket: new Bucket(10, 1) };
    const gone = () => { entry.gone = true; this.leave(entry); };
    server.addEventListener("close", gone);
    server.addEventListener("error", gone);
    server.addEventListener("message", (e) => {
      if (typeof e.data !== "string" || e.data.length > 256 || !entry.bucket.take()) return;
      try { const d = JSON.parse(e.data); if (d && d.t === "cancel") { gone(); server.close(1000, "cancel"); } } catch (x) {}
    });
    // 1) an open public room with free seats? send them there
    const now = Date.now();
    for (const [code, r] of this.rooms) {
      if (now - r.ts > 10 * 60 * 1000) { this.rooms.delete(code); continue; }
      if (r.free > 0) { r.free--; this.send(entry, { t: "matched", code }); setTimeout(() => { try { server.close(1000, "matched"); } catch (x) {} }, 500); return ws101(client); }
    }
    // 2) else wait in queue
    this.queue = this.queue.filter((q) => q.pid !== entry.pid);
    this.queue.push(entry);
    this.status();
    this.check();
    return ws101(client);
  }
  send(q, o) { try { q.ws.send(JSON.stringify(o)); } catch (x) {} }
  leave(q) { const n = this.queue.length; this.queue = this.queue.filter((x) => x !== q); if (this.queue.length !== n) { this.status(); this.check(); } }
  status() {
    const left = this.timer ? Math.max(0, Math.ceil((this.deadline - Date.now()) / 1000)) : null;
    this.queue.forEach((q) => this.send(q, { t: "queue", n: this.queue.length, startsIn: left }));
  }
  check() {
    if (this.launching || this.retryT) return;
    if (this.queue.length >= 4) return this.launch();
    if (this.queue.length >= 2 && !this.timer) {
      this.deadline = Date.now() + 20000;
      this.timer = setTimeout(() => this.launch(), 20000);
      this.tick = setInterval(() => this.status(), 1000);
      this.status();
    }
    if (this.queue.length < 2 && this.timer) { clearTimeout(this.timer); clearInterval(this.tick); this.timer = null; this.status(); }
  }
  // make a room for up to 4 queued players; `matched` goes out only after Room.init answered 200
  async launch() {
    clearTimeout(this.timer); clearInterval(this.tick); this.timer = null;
    if (this.launching) return;
    const group = this.queue.splice(0, 4);
    if (group.length < 2) { this.queue.unshift(...group); return; }
    this.launching = true;
    let code = null;
    try {
      for (let i = 0; i < 8 && !code; i++) {
        const c = newCode();
        try {
          const r = await this.env.ROOM.get(this.env.ROOM.idFromName(c)).fetch("https://do/init", { method: "POST", body: JSON.stringify({ code: c, public: true, max: 4, quick: true }) });
          if (r && r.status === 200) code = c;
        } catch (x) {}
      }
    } finally { this.launching = false; }
    const live = group.filter((q) => !q.gone);
    if (code) {
      this.fails = 0;
      live.forEach((q) => { this.send(q, { t: "matched", code }); setTimeout(() => { try { q.ws.close(1000, "matched"); } catch (x) {} }, 500); });
      this.check();
      return;
    }
    // no room could be made: keep the players queued (front of the line), tell them, try again shortly
    this.fails++;
    console.log("quick-match init exhausted", this.fails);
    if (this.fails >= 3) {
      this.fails = 0;
      live.forEach((q) => { this.send(q, { t: "err", code: "busy", m: "Matchmaking is busy. Try again in a minute." }); try { q.ws.close(1013, "busy"); } catch (x) {} });
      this.status(); this.check();
      return;
    }
    this.queue.unshift(...live);
    live.forEach((q) => this.send(q, { t: "err", code: "retry", m: "Still looking for a free room…" }));
    this.status();
    this.retryT = setTimeout(() => { this.retryT = null; if (this.queue.length >= 2) this.launch(); else this.check(); }, 3000 * this.fails);
  }
}

// ---------- Room: roster, host, relay, snapshot for host migration ----------
export class Room {
  constructor(state, env) {
    this.state = state; this.env = env;
    this.s = null; // {code, public, max, status, host, players:[{pid,name,seat,ver,proto,tok}], created}
    this.socks = new Map(); // pid -> ws
    this.meta = new Map(); // ws -> {pid, seen, bucket, drops}
    this.snap = null;
    this.wsRate = new Window(LIMITS.wsPerMin, 60_000);
    this.stats = { auth: 0, big: 0, shape: 0, rate: 0, seat: 0 };
  }
  async load() { if (!this.s) this.s = (await this.state.storage.get("s")) || null; if (this.snap === null) this.snap = (await this.state.storage.get("snap")) || null; }
  save() { return this.state.storage.put("s", this.s); }
  // is this pid's socket open and heard from recently?
  live(pid, now = Date.now()) {
    const w = this.socks.get(pid);
    if (!w) return false;
    if (w.readyState !== undefined && w.readyState !== 1) return false;
    const mt = this.meta.get(w);
    return !mt || now - mt.seen < LIMITS.staleMs;
  }
  async fetch(req) {
    const url = new URL(req.url);
    await this.load();
    if (url.pathname === "/init") {
      if (this.s && Date.now() - this.s.created < 6 * 3600 * 1000) return json({ error: "taken" }, 409);
      const d = await req.json();
      this.s = { code: d.code, public: !!d.public, max: clampSeats(d.max), status: "lobby", host: null, players: [], created: Date.now(), quick: !!d.quick };
      this.snap = null; await this.state.storage.delete("snap");
      await this.save(); this.notifyLobby();
      return json({ ok: true });
    }
    if (url.pathname === "/info") {
      if (!this.s) return json({ error: "no room" }, 404);
      return json({ code: this.s.code, status: this.s.status, public: this.s.public, max: this.s.max, players: this.s.players.length });
    }
    if (url.pathname === "/ws") {
      if (req.headers.get("Upgrade") !== "websocket") return json({ error: "ws only" }, 426);
      const [client, server] = Object.values(new WebSocketPair());
      server.accept();
      const refuse = (code, reason, m, extra) => { if (m) server.send(JSON.stringify({ t: "err", m, ...(extra || {}) })); server.close(code, reason); return ws101(client); };
      if (!this.s) return refuse(4004, "no room", "Room not found");
      const q = url.searchParams;
      const proto = parseProto(q.get("proto"));
      if (proto < PROTO_MIN) return refuse(4026, "upgrade", "Please update Scorched Tanks to play online", { code: "upgrade", proto: PROTO, minProto: PROTO_MIN });
      if (this.wsRate.hit(ipOf(req))) { this.stats.rate++; return refuse(4029, "rate", "Too many connections, wait a minute", { code: "rate" }); }
      const pid = cleanPid(q.get("pid")), name = clean(q.get("name"));
      const ver = String(q.get("ver") || "").replace(/[^0-9.]/g, "").slice(0, 12);
      const tok = String(q.get("tok") || "").slice(0, 64);
      let me = this.s.players.find((x) => x.pid === pid);
      if (!me) {
        if (this.s.status !== "lobby") return refuse(4009, "started", "Game already started");
        if (this.s.players.length >= this.s.max) return refuse(4008, "full", "Room is full");
        const used = new Set(this.s.players.map((x) => x.seat));
        let seat = 0; while (used.has(seat)) seat++;
        me = { pid, name, seat, ver, proto, tok: newTok() };
        this.s.players.push(me);
      } else {
        // taking over an existing seat
        const good = !!tok && !!me.tok && safeEq(tok, me.tok);
        if (!good) {
          const legacySeat = !(me.proto >= 2) || !me.tok;
          if (!legacySeat) { this.stats.seat++; return refuse(4003, "seat", "This seat belongs to another player", { code: "seat" }); }
          // proto-1 seat: no proof possible; allowed only when the old socket is gone. No err text, so a v1.15 client backs off and retries.
          if (this.live(pid)) { this.stats.seat++; return refuse(4003, "seat"); }
          me.tok = newTok();
        }
        me.name = name; me.ver = ver; me.proto = proto;
      }
      const old = this.socks.get(pid); if (old) { this.meta.delete(old); try { old.close(4000, "replaced"); } catch (x) {} }
      this.socks.set(pid, server);
      this.meta.set(server, { pid, seen: Date.now(), bucket: new Bucket(LIMITS.burst, LIMITS.perSec), drops: 0 });
      if (!this.s.host || !this.socks.has(this.s.host)) this.s.host = pid;
      await this.save();
      server.send(JSON.stringify({ t: "hello", pid, code: this.s.code, tok: me.tok, proto: PROTO, minProto: PROTO_MIN }));
      if (this.s.status === "playing" && this.snap && pid !== this.s.host) this.sendTo(this.s.host, { t: "msg", from: "server", d: { k: "rejoin", pid } });
      this.roster(); this.notifyLobby();
      server.addEventListener("message", (e) => this.onMsg(pid, server, e.data));
      const bye = () => this.onClose(pid, server);
      server.addEventListener("close", bye); server.addEventListener("error", bye);
      return ws101(client);
    }
    return json({ error: "nf" }, 404);
  }
  sendTo(pid, o) { const w = this.socks.get(pid); if (w) try { w.send(JSON.stringify(o)); } catch (x) {} }
  bcast(o, except) { const m = JSON.stringify(o); for (const [p, w] of this.socks) if (p !== except) try { w.send(m); } catch (x) {} }
  roster() {
    const s = this.s;
    this.bcast({ t: "roster", code: s.code, host: s.host, status: s.status, public: s.public, max: s.max, proto: PROTO, minProto: PROTO_MIN,
      players: s.players.map((x) => ({ pid: x.pid, name: x.name, seat: x.seat, ver: x.ver, proto: x.proto || 1, on: this.socks.has(x.pid) })) });
  }
  notifyLobby() {
    const s = this.s; if (!s) return;
    const free = s.max - s.players.length;
    this.env.LOBBY.get(this.env.LOBBY.idFromName("main")).fetch("https://do/room-update", { method: "POST", body: JSON.stringify({ code: s.code, public: s.public, status: s.status, free }) }).catch(() => {});
  }
  // relay gate: may this sender relay this game message?
  relayOk(pid, isHost, g, size) {
    if (!isObj(g) || typeof g.k !== "string" || !g.k || g.k.length > 24) return "shape";
    if (g.k === "rejoin") return "auth";
    if (HOST_KINDS.has(g.k) && !isHost) return "auth";
    if (g.k === "shop" && g.pid !== pid) return "auth";
    const km = LIMITS.kindMax[g.k];
    if (km && size > km) return "big";
    switch (g.k) {
      case "state": if (!isObj(g.d)) return "shape"; break;
      case "begin": if (!Array.isArray(g.players) || g.players.length > LIMITS.maxSeats * 2) return "shape"; break;
      case "cfg": if (!isObj(g.cfg)) return "shape"; break;
      case "shop": if (!Array.isArray(g.stock) || !Array.isArray(g.items) || g.stock.length > 128 || g.items.length > 128) return "shape"; break;
      case "shopReady": if (!Array.isArray(g.pids) || g.pids.length > 16) return "shape"; break;
      case "aim": case "fire": case "item": case "move": if (!Number.isInteger(g.ti) || g.ti < 0 || g.ti > 63) return "shape"; break;
    }
    return "";
  }
  async onMsg(pid, ws, raw) {
    if (this.socks.get(pid) !== ws) return; // a replaced socket says nothing more
    const mt = this.meta.get(ws);
    if (mt) mt.seen = Date.now();
    if (typeof raw !== "string") return;
    const isHost = pid === this.s.host;
    // bound the frame before parsing it
    if (raw.length > (isHost ? LIMITS.hostFrame : LIMITS.peerFrame)) { this.stats.big++; return; }
    if (mt && !mt.bucket.take()) {
      this.stats.rate++;
      if (++mt.drops >= LIMITS.dropClose) {
        console.log("room rate-limit close", this.s.code);
        try { ws.send(JSON.stringify({ t: "err", code: "rate", m: "Too many messages" })); ws.close(4029, "rate"); } catch (x) {}
      }
      return;
    }
    let d; try { d = JSON.parse(raw); } catch (x) { this.stats.shape++; return; }
    if (!isObj(d) || typeof d.t !== "string") { this.stats.shape++; return; }
    switch (d.t) {
      case "ping": try { ws.send('{"t":"pong"}'); } catch (x) {} break;
      case "relay": {
        const why = this.relayOk(pid, isHost, d.d, raw.length);
        if (why) { this.stats[why]++; return; }
        if (d.to != null) {
          if (typeof d.to !== "string" || !this.socks.has(d.to)) return;
          this.sendTo(d.to, { t: "msg", from: pid, d: d.d });
        } else this.bcast({ t: "msg", from: pid, d: d.d }, pid);
        break;
      }
      case "snap": if (isHost && isObj(d.d)) { this.snap = d.d; await this.state.storage.put("snap", d.d); } break;
      case "start":
        if (isHost && this.socks.size >= 1) { this.s.status = "playing"; await this.save(); this.roster(); this.notifyLobby(); }
        break;
      case "end": if (isHost) { this.s.status = "lobby"; this.snap = null; await this.state.storage.delete("snap"); await this.save(); this.roster(); this.notifyLobby(); } break;
      case "public": if (isHost) { this.s.public = !!d.v; await this.save(); this.roster(); this.notifyLobby(); } break;
      case "max":
        if (isHost && this.s.status === "lobby") {
          this.s.max = Math.max(clampSeats(d.v), this.s.players.length, LIMITS.minSeats);
          await this.save(); this.roster(); this.notifyLobby();
        }
        break;
      case "kick":
        if (isHost && typeof d.pid === "string" && d.pid !== pid) {
          this.sendTo(d.pid, { t: "err", m: "Removed by host" });
          const w = this.socks.get(d.pid); if (w) { this.meta.delete(w); try { w.close(4001, "kicked"); } catch (x) {} }
          this.socks.delete(d.pid);
          if (this.s.status === "lobby") this.s.players = this.s.players.filter((x) => x.pid !== d.pid);
          await this.save(); this.roster(); this.notifyLobby();
        }
        break;
    }
  }
  async onClose(pid, ws) {
    this.meta.delete(ws);
    if (this.socks.get(pid) !== ws) return;
    this.socks.delete(pid);
    if (this.s.status === "lobby") this.s.players = this.s.players.filter((x) => x.pid !== pid);
    if (this.s.host === pid) {
      const next = this.s.players.find((x) => this.socks.has(x.pid));
      this.s.host = next ? next.pid : null;
      if (next) this.bcast({ t: "host", pid: next.pid, snap: this.s.status === "playing" ? this.snap : null });
    }
    if (this.socks.size === 0 && this.s.status === "playing") { this.s.status = "lobby"; }
    await this.save(); this.roster(); this.notifyLobby();
  }
}

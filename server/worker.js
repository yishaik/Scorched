// Scorched Tanks multiplayer relay — Cloudflare Worker + Durable Objects
// Routes:
//   GET  /health
//   POST /api/room            {public?:bool, max?:2-6}  -> {code}
//   GET  /api/room/:code       -> room info
//   WS   /ws/quick?name=&pid=  -> Lobby (matchmaking); server replies {t:"matched", code}
//   WS   /ws/room/:code?name=&pid= -> Room relay
// Room protocol (JSON):
//   c->s {t:"start"} host only | {t:"relay", d, to?} | {t:"snap", d} host only | {t:"public", v} host only | {t:"kick", pid} host only | {t:"ping"}
//   s->c {t:"hello", pid, code} | {t:"roster", code, host, status, public, max, players:[{pid,name,seat,on}]}
//        {t:"msg", from, d} | {t:"host", pid, snap} (host migration) | {t:"err", m} | {t:"pong"}

import LANDING from "./landing.txt";
import GAME from "./game.txt";
import APK from "./app.apk.bin";
const APP_VER = "1.12";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "content-type" };
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", ...CORS } });
const ALPH = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const newCode = () => Array.from({ length: 4 }, () => ALPH[Math.floor(Math.random() * ALPH.length)]).join("");
const clean = (s, n = 16) => String(s || "").replace(/[^\p{L}\p{N} _.-]/gu, "").trim().slice(0, n) || "Player";
const rid = () => crypto.randomUUID().slice(0, 8);

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (p === "/health") return json({ ok: true, game: "scorched-tanks", v: 2, app: APP_VER });
    const html = (b) => new Response(b, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
    if (p === "/" || /^\/join\/[A-Za-z]{4}\/?$/.test(p)) return html(LANDING);
    if (p === "/play" || p === "/play/") return html(GAME);
    if (p === "/hark.js") return new Response("", { headers: { "content-type": "application/javascript" } });
    if (p === "/download" || p === "/ScorchedTanks.apk") return new Response(APK, { headers: { "content-type": "application/vnd.android.package-archive", "content-disposition": 'attachment; filename="ScorchedTanks-' + APP_VER + '.apk"', "cache-control": "no-cache" } });
    if (p === "/.well-known/assetlinks.json") return json([{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: "com.yishai.scorchedtanks", sha256_cert_fingerprints: ["0B:23:9E:D6:B6:E3:C7:4F:05:EC:3B:C6:E4:6A:66:D9:3D:EB:77:9B:62:D8:01:46:89:9E:93:0C:BB:7F:6D:98"] } }]);
    if (p === "/api/room" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      for (let i = 0; i < 8; i++) {
        const code = newCode();
        const stub = env.ROOM.get(env.ROOM.idFromName(code));
        const r = await stub.fetch("https://do/init", { method: "POST", body: JSON.stringify({ code, public: !!body.public, max: body.max }) });
        if (r.status === 200) return json({ code });
      }
      return json({ error: "busy" }, 503);
    }
    let m = p.match(/^\/api\/room\/([A-Z]{4})$/);
    if (m) return env.ROOM.get(env.ROOM.idFromName(m[1])).fetch("https://do/info");
    if (p === "/ws/quick") return env.LOBBY.get(env.LOBBY.idFromName("main")).fetch(req);
    m = p.match(/^\/ws\/room\/([A-Za-z]{4})$/);
    if (m) {
      const code = m[1].toUpperCase();
      return env.ROOM.get(env.ROOM.idFromName(code)).fetch(new Request("https://do/ws?" + url.searchParams + "&code=" + code, req));
    }
    return json({ error: "not found" }, 404);
  },
};

// ---------- Lobby: matchmaking queue + list of open public rooms ----------
export class Lobby {
  constructor(state, env) {
    this.env = env;
    this.queue = []; // {ws, name, pid, t}
    this.rooms = new Map(); // code -> {free, status, ts}
    this.timer = null;
  }
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/room-update") {
      const d = await req.json();
      if (!d.public || d.status !== "lobby" || d.free <= 0) this.rooms.delete(d.code);
      else this.rooms.set(d.code, { free: d.free, ts: Date.now() });
      return json({ ok: true });
    }
    if (req.headers.get("Upgrade") !== "websocket") return json({ error: "ws only" }, 426);
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const entry = { ws: server, name: clean(url.searchParams.get("name")), pid: url.searchParams.get("pid") || rid(), t: Date.now() };
    server.addEventListener("close", () => this.leave(entry));
    server.addEventListener("error", () => this.leave(entry));
    server.addEventListener("message", (e) => { try { const d = JSON.parse(e.data); if (d.t === "cancel") { this.leave(entry); server.close(1000, "cancel"); } } catch (x) {} });
    // 1) an open public room with free seats? send them there
    const now = Date.now();
    for (const [code, r] of this.rooms) {
      if (now - r.ts > 10 * 60 * 1000) { this.rooms.delete(code); continue; }
      if (r.free > 0) { r.free--; this.send(entry, { t: "matched", code }); setTimeout(() => { try { server.close(1000, "matched"); } catch (x) {} }, 500); return new Response(null, { status: 101, webSocket: client }); }
    }
    // 2) else wait in queue
    this.queue = this.queue.filter((q) => q.pid !== entry.pid);
    this.queue.push(entry);
    this.status();
    this.check();
    return new Response(null, { status: 101, webSocket: client });
  }
  send(q, o) { try { q.ws.send(JSON.stringify(o)); } catch (x) {} }
  leave(q) { const n = this.queue.length; this.queue = this.queue.filter((x) => x !== q); if (this.queue.length !== n) { this.status(); this.check(); } }
  status() {
    const left = this.timer ? Math.max(0, Math.ceil((this.deadline - Date.now()) / 1000)) : null;
    this.queue.forEach((q) => this.send(q, { t: "queue", n: this.queue.length, startsIn: left }));
  }
  check() {
    if (this.queue.length >= 4) return this.launch();
    if (this.queue.length >= 2 && !this.timer) {
      this.deadline = Date.now() + 20000;
      this.timer = setTimeout(() => this.launch(), 20000);
      this.tick = setInterval(() => this.status(), 1000);
      this.status();
    }
    if (this.queue.length < 2 && this.timer) { clearTimeout(this.timer); clearInterval(this.tick); this.timer = null; this.status(); }
  }
  async launch() {
    clearTimeout(this.timer); clearInterval(this.tick); this.timer = null;
    const group = this.queue.splice(0, 4);
    if (group.length < 2) { this.queue.unshift(...group); return; }
    let code;
    for (let i = 0; i < 8; i++) {
      code = newCode();
      const r = await this.env.ROOM.get(this.env.ROOM.idFromName(code)).fetch("https://do/init", { method: "POST", body: JSON.stringify({ code, public: true, max: 4, quick: true }) });
      if (r.status === 200) break;
    }
    group.forEach((q) => { this.send(q, { t: "matched", code }); setTimeout(() => { try { q.ws.close(1000, "matched"); } catch (x) {} }, 500); });
    this.check();
  }
}

// ---------- Room: roster, host, relay, snapshot for host migration ----------
export class Room {
  constructor(state, env) {
    this.state = state; this.env = env;
    this.s = null; // {code, public, max, status, host, players:[{pid,name,seat}], created}
    this.socks = new Map(); // pid -> ws
    this.snap = null;
  }
  async load() { if (!this.s) this.s = (await this.state.storage.get("s")) || null; if (this.snap === null) this.snap = (await this.state.storage.get("snap")) || null; }
  save() { return this.state.storage.put("s", this.s); }
  async fetch(req) {
    const url = new URL(req.url);
    await this.load();
    if (url.pathname === "/init") {
      if (this.s && Date.now() - this.s.created < 6 * 3600 * 1000) return json({ error: "taken" }, 409);
      const d = await req.json();
      this.s = { code: d.code, public: !!d.public, max: Math.min(6, Math.max(2, d.max | 0 || 4)), status: "lobby", host: null, players: [], created: Date.now(), quick: !!d.quick };
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
      if (!this.s) { server.send(JSON.stringify({ t: "err", m: "Room not found" })); server.close(4004, "no room"); return new Response(null, { status: 101, webSocket: client }); }
      const pid = (url.searchParams.get("pid") || rid()).slice(0, 40), name = clean(url.searchParams.get("name"));
      const ver = String(url.searchParams.get("ver") || "").replace(/[^0-9.]/g, "").slice(0, 12);
      let me = this.s.players.find((x) => x.pid === pid);
      if (!me) {
        if (this.s.status !== "lobby") { server.send(JSON.stringify({ t: "err", m: "Game already started" })); server.close(4009, "started"); return new Response(null, { status: 101, webSocket: client }); }
        if (this.s.players.length >= this.s.max) { server.send(JSON.stringify({ t: "err", m: "Room is full" })); server.close(4008, "full"); return new Response(null, { status: 101, webSocket: client }); }
        const used = new Set(this.s.players.map((x) => x.seat));
        let seat = 0; while (used.has(seat)) seat++;
        me = { pid, name, seat, ver };
        this.s.players.push(me);
      } else { me.name = name; me.ver = ver; }
      const old = this.socks.get(pid); if (old) try { old.close(4000, "replaced"); } catch (x) {}
      this.socks.set(pid, server);
      if (!this.s.host || !this.socks.has(this.s.host)) this.s.host = pid;
      await this.save();
      server.send(JSON.stringify({ t: "hello", pid, code: this.s.code }));
      if (this.s.status === "playing" && this.snap && pid !== this.s.host) this.sendTo(this.s.host, { t: "msg", from: "server", d: { k: "rejoin", pid } });
      this.roster(); this.notifyLobby();
      server.addEventListener("message", (e) => this.onMsg(pid, server, e.data));
      const bye = () => this.onClose(pid, server);
      server.addEventListener("close", bye); server.addEventListener("error", bye);
      return new Response(null, { status: 101, webSocket: client });
    }
    return json({ error: "nf" }, 404);
  }
  sendTo(pid, o) { const w = this.socks.get(pid); if (w) try { w.send(JSON.stringify(o)); } catch (x) {} }
  bcast(o, except) { const m = JSON.stringify(o); for (const [p, w] of this.socks) if (p !== except) try { w.send(m); } catch (x) {} }
  roster() {
    const s = this.s;
    this.bcast({ t: "roster", code: s.code, host: s.host, status: s.status, public: s.public, max: s.max, players: s.players.map((x) => ({ ...x, on: this.socks.has(x.pid) })) });
  }
  notifyLobby() {
    const s = this.s; if (!s) return;
    const free = s.max - s.players.length;
    this.env.LOBBY.get(this.env.LOBBY.idFromName("main")).fetch("https://do/room-update", { method: "POST", body: JSON.stringify({ code: s.code, public: s.public, status: s.status, free }) }).catch(() => {});
  }
  async onMsg(pid, ws, raw) {
    if (typeof raw !== "string" || raw.length > 2_000_000) return;
    let d; try { d = JSON.parse(raw); } catch (x) { return; }
    const isHost = pid === this.s.host;
    switch (d.t) {
      case "ping": ws.send('{"t":"pong"}'); break;
      case "relay":
        if (d.to) this.sendTo(d.to, { t: "msg", from: pid, d: d.d });
        else this.bcast({ t: "msg", from: pid, d: d.d }, pid);
        break;
      case "snap": if (isHost) { this.snap = d.d; await this.state.storage.put("snap", d.d); } break;
      case "start":
        if (isHost && this.socks.size >= 1) { this.s.status = "playing"; await this.save(); this.roster(); this.notifyLobby(); }
        break;
      case "end": if (isHost) { this.s.status = "lobby"; this.snap = null; await this.state.storage.delete("snap"); await this.save(); this.roster(); this.notifyLobby(); } break;
      case "public": if (isHost) { this.s.public = !!d.v; await this.save(); this.roster(); this.notifyLobby(); } break;
      case "kick":
        if (isHost && d.pid !== pid) {
          this.sendTo(d.pid, { t: "err", m: "Removed by host" });
          const w = this.socks.get(d.pid); if (w) try { w.close(4001, "kicked"); } catch (x) {}
          this.socks.delete(d.pid);
          if (this.s.status === "lobby") this.s.players = this.s.players.filter((x) => x.pid !== d.pid);
          await this.save(); this.roster(); this.notifyLobby();
        }
        break;
    }
  }
  async onClose(pid, ws) {
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

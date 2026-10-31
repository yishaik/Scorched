// Node tests for server/worker.js with minimal mocks of the Cloudflare runtime.
// Run: node --test tests/   (Node 18+; no dependencies)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

// ---- runtime mocks ----
class MockResponse {
  constructor(body, init = {}) {
    this.body = body; this.status = init.status ?? 200;
    this.headers = new Headers(init.headers || {}); this.webSocket = init.webSocket;
  }
  async json() { return JSON.parse(this.body); }
  async text() { return String(this.body ?? ""); }
}
globalThis.Response = MockResponse;
class MockWS {
  constructor() { this.ls = {}; this.sent = []; this.readyState = 1; this.closed = null; }
  accept() {}
  addEventListener(t, f) { (this.ls[t] ||= []).push(f); }
  send(s) { if (this.readyState !== 1) throw new Error("closed"); this.sent.push(JSON.parse(s)); }
  close(code, reason) { this.readyState = 3; this.closed = { code, reason }; }
  emit(t, ev) { return Promise.all((this.ls[t] || []).map((f) => f(ev))); }
  // the client side went away
  drop() { this.readyState = 3; return this.emit("close", {}); }
  msg(o) { return this.emit("message", { data: typeof o === "string" ? o : JSON.stringify(o) }); }
  last(t) { return [...this.sent].reverse().find((m) => m.t === t); }
  all(t) { return this.sent.filter((m) => m.t === t); }
}
let lastServer = null;
globalThis.WebSocketPair = function () { const c = new MockWS(), s = new MockWS(); lastServer = s; return { 0: c, 1: s }; };

// load worker.js with its three asset imports stubbed
const src = readFileSync(root + "server/worker.js", "utf8")
  .replace('import LANDING from "./landing.txt";', 'const LANDING = "<landing>";')
  .replace('import GAME from "./game.txt";', 'const GAME = "<game>";')
  .replace('import APK from "./app.apk.bin";', 'const APK = "apk";');
const W = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
const worker = W.default, { Lobby, Room, LIMITS } = W;

function storage() {
  const m = new Map();
  return { get: async (k) => structuredClone(m.get(k)), put: async (k, v) => void m.set(k, structuredClone(v)), delete: async (k) => void m.delete(k) };
}
function makeEnv(opts = {}) {
  const env = {};
  const rooms = new Map(); let lobby = null;
  env.inits = 0;
  const toReq = (u, init) => (u instanceof Request ? u : new Request(u, init));
  env.ROOM = {
    idFromName: (n) => n,
    get: (id) => ({
      fetch: async (u, init) => {
        const req = toReq(u, init);
        if (new URL(req.url).pathname === "/init") {
          env.inits++;
          if (opts.initFail) { const r = opts.initFail(env.inits); if (r === "throw") throw new Error("network"); if (r) return new MockResponse("{}", { status: r }); }
        }
        if (!rooms.has(id)) rooms.set(id, new Room({ storage: storage() }, env));
        return rooms.get(id).fetch(req);
      },
    }),
  };
  env.LOBBY = { idFromName: (n) => n, get: () => ({ fetch: async (u, init) => { lobby ||= new Lobby({}, env); return lobby.fetch(toReq(u, init)); } }) };
  env.rooms = rooms; env.lobby = () => (lobby ||= new Lobby({}, env));
  return env;
}
const ws = (path, q = {}, ip = "1.1.1.1") =>
  new Request("https://scorched-tanks.yishai-k.workers.dev" + path + "?" + new URLSearchParams(q), { headers: { Upgrade: "websocket", "CF-Connecting-IP": ip } });
async function connect(env, code, q, ip) { const r = await worker.fetch(ws("/ws/room/" + code, q, ip), env); assert.equal(r.status, 101); return lastServer; }
async function createRoom(env, body = {}, ip = "9.9.9.9", origin) {
  const h = { "content-type": "application/json", "CF-Connecting-IP": ip }; if (origin) h.Origin = origin;
  return worker.fetch(new Request("https://x/api/room", { method: "POST", headers: h, body: JSON.stringify(body) }), env);
}
async function newRoom(env, body) { const r = await createRoom(env, body); assert.equal(r.status, 200); return (await r.json()).code; }
const flush = () => new Promise((r) => setTimeout(r, 0));

// ---- tests ----
test("normal room: create, join, hello carries a token only for its owner, roster never does", async () => {
  const env = makeEnv();
  const code = await newRoom(env, { max: 4 });
  const a = await connect(env, code, { name: "Ann", pid: "pidA123", ver: "1.16", proto: "2" });
  const b = await connect(env, code, { name: "Bob", pid: "pidB123", ver: "1.15" });
  const ha = a.last("hello"), hb = b.last("hello");
  assert.match(ha.tok, /^[0-9a-f]{32}$/); assert.notEqual(ha.tok, hb.tok);
  assert.equal(ha.proto, 2);
  const r = a.last("roster");
  assert.equal(r.host, "pidA123"); assert.equal(r.players.length, 2);
  assert.ok(!JSON.stringify(a.all("roster")).includes(ha.tok) && !JSON.stringify(b.sent).includes(ha.tok), "token leaked");
  assert.deepEqual(r.players.map((p) => p.proto), [2, 1]);
  assert.ok(r.players.every((p) => !("tok" in p)));
});

test("forged pid takeover of a token seat is refused; the owner keeps the seat", async () => {
  const env = makeEnv();
  const code = await newRoom(env);
  const a = await connect(env, code, { name: "Ann", pid: "victim01", proto: "2" });
  await connect(env, code, { name: "Bob", pid: "other001", proto: "2" });
  const room = env.rooms.get(code);
  const evil = await connect(env, code, { name: "Eve", pid: "victim01", proto: "2" }, "6.6.6.6");
  assert.equal(evil.closed.code, 4003); assert.equal(evil.last("err").code, "seat");
  const evil2 = await connect(env, code, { name: "Eve", pid: "victim01", proto: "2", tok: "0".repeat(32) }, "6.6.6.6");
  assert.equal(evil2.closed.code, 4003);
  // no proto at all (pretending to be a v1.15 client) does not help on a token seat
  const evil3 = await connect(env, code, { name: "Eve", pid: "victim01" }, "6.6.6.6");
  assert.equal(evil3.closed.code, 4003);
  assert.equal(room.socks.get("victim01"), a); assert.equal(a.readyState, 1);
  // and in a running match, even after the owner dropped
  await a.msg({ t: "start" });
  await a.drop();
  const evil4 = await connect(env, code, { name: "Eve", pid: "victim01", proto: "2" }, "6.6.6.6");
  assert.equal(evil4.closed.code, 4003);
});

test("valid rejoin with the token takes the seat back (old socket replaced)", async () => {
  const env = makeEnv();
  const code = await newRoom(env);
  const a = await connect(env, code, { name: "Ann", pid: "pidA123", proto: "2" });
  const b = await connect(env, code, { name: "Bob", pid: "pidB123", proto: "2" });
  const tok = b.last("hello").tok;
  await a.msg({ t: "start" });
  const b2 = await connect(env, code, { name: "Bob", pid: "pidB123", proto: "2", tok });
  assert.equal(b.closed.code, 4000);
  assert.equal(b2.last("hello").tok, tok, "token stays the same on a valid rejoin");
  assert.equal(env.rooms.get(code).socks.get("pidB123"), b2);
  // host is told to send the match to the rejoining player
  assert.ok(a.sent.some((m) => m.t === "msg" && m.from === "server" && m.d.k === "rejoin" && m.d.pid === "pidB123") || !env.rooms.get(code).snap);
});

test("legacy (v1.15, no proto/tok) reconnect: allowed when the old socket is gone or silent, refused while live", async () => {
  const env = makeEnv();
  const code = await newRoom(env);
  const a = await connect(env, code, { name: "Ann", pid: "pidA123", ver: "1.15" });
  const b = await connect(env, code, { name: "Bob", pid: "pidB123", ver: "1.15" });
  await a.msg({ t: "start" });
  // live seat: refused with a bare close (no err), so a v1.15 client backs off and retries
  const t1 = await connect(env, code, { name: "Bob", pid: "pidB123", ver: "1.15" });
  assert.equal(t1.closed.code, 4003); assert.equal(t1.all("err").length, 0);
  // the seat went quiet longer than staleMs (half-open connection): allowed
  const room = env.rooms.get(code);
  room.meta.get(b).seen = Date.now() - LIMITS.staleMs - 1;
  const t2 = await connect(env, code, { name: "Bob", pid: "pidB123", ver: "1.15" });
  assert.equal(t2.readyState, 1); assert.equal(room.socks.get("pidB123"), t2); assert.equal(b.closed.code, 4000);
  // closed seat: allowed
  await t2.drop();
  const t3 = await connect(env, code, { name: "Bob", pid: "pidB123", ver: "1.15" });
  assert.equal(room.socks.get("pidB123"), t3);
  assert.equal(t3.last("roster").players.find((p) => p.pid === "pidB123").on, true);
});

test("non-host cannot relay authoritative messages; host can; shop must carry the sender's pid", async () => {
  const env = makeEnv();
  const code = await newRoom(env);
  const h = await connect(env, code, { name: "Host", pid: "hostpid1", proto: "2" });
  const p = await connect(env, code, { name: "Peer", pid: "peerpid1", proto: "2" });
  const n0 = h.all("msg").length;
  for (const k of ["state", "begin", "cfg", "shopOpen", "shopReady"]) await p.msg({ t: "relay", d: { k, d: {}, players: [], cfg: {}, pids: [], round: 1 } });
  await p.msg({ t: "relay", d: { k: "rejoin", pid: "x" } });
  await p.msg({ t: "relay", d: { k: "shop", pid: "hostpid1", round: 1, cash: 1, stock: [], items: [] } });
  await p.msg({ t: "relay", d: "not-an-object" });
  await p.msg({ t: "relay", d: { k: "aim", ti: "x" } });
  assert.equal(h.all("msg").length, n0, "forged messages reached the host");
  await p.msg({ t: "relay", d: { k: "shop", pid: "peerpid1", round: 1, cash: 1, stock: [], items: [] } });
  await p.msg({ t: "relay", d: { k: "aim", ti: 1, angle: 45, power: 50, weapon: 0 } });
  await p.msg({ t: "relay", d: { k: "needState" }, to: "hostpid1" });
  assert.deepEqual(h.all("msg").slice(n0).map((m) => m.d.k), ["shop", "aim", "needState"]);
  const m0 = p.all("msg").length;
  await h.msg({ t: "relay", d: { k: "state", d: { round: 1 }, why: "sync" } });
  await h.msg({ t: "relay", d: { k: "cfg", cfg: { rounds: 3 } } });
  assert.deepEqual(p.all("msg").slice(m0).map((m) => m.d.k), ["state", "cfg"]);
  assert.ok(env.rooms.get(code).stats.auth >= 7);
  // non-host room controls are ignored
  await p.msg({ t: "start" }); await p.msg({ t: "kick", pid: "hostpid1" }); await p.msg({ t: "max", v: 6 });
  const room = env.rooms.get(code);
  assert.equal(room.s.status, "lobby"); assert.equal(room.s.max, 4); assert.equal(h.readyState, 1);
});

test("host migration: the new host may then send state", async () => {
  const env = makeEnv();
  const code = await newRoom(env);
  const h = await connect(env, code, { name: "Host", pid: "hostpid1", proto: "2" });
  const p = await connect(env, code, { name: "Peer", pid: "peerpid1", proto: "2" });
  const q = await connect(env, code, { name: "Q", pid: "qpid0001" });
  await h.msg({ t: "start" });
  await h.msg({ t: "snap", d: { round: 1 } });
  await h.drop();
  assert.equal(p.last("host").pid, "peerpid1"); assert.deepEqual(p.last("host").snap, { round: 1 });
  const n = q.all("msg").length;
  await p.msg({ t: "relay", d: { k: "state", d: { round: 1 }, why: "turn" } });
  assert.equal(q.all("msg").length, n + 1);
});

test("oversized payloads are dropped before parsing (peer 32 KB, host 2 MB)", async () => {
  const env = makeEnv();
  const code = await newRoom(env);
  const h = await connect(env, code, { name: "Host", pid: "hostpid1", proto: "2" });
  const p = await connect(env, code, { name: "Peer", pid: "peerpid1", proto: "2" });
  const big = "x".repeat(LIMITS.peerFrame + 10);
  const n = h.all("msg").length;
  await p.msg({ t: "relay", d: { k: "aim", ti: 0, pad: big } });
  assert.equal(h.all("msg").length, n);
  // the host may send a large state, but not over the host cap, and small-kind caps hold
  const m = p.all("msg").length;
  await h.msg({ t: "relay", d: { k: "state", d: { pad: big }, why: "sync" } });
  assert.equal(p.all("msg").length, m + 1);
  await h.msg({ t: "relay", d: { k: "state", d: { pad: "x".repeat(LIMITS.hostFrame) } } });
  await h.msg({ t: "relay", d: { k: "cfg", cfg: { pad: "x".repeat(70000) } } });
  assert.equal(p.all("msg").length, m + 1);
  assert.ok(env.rooms.get(code).stats.big >= 3);
  // binary frames are ignored
  await p.emit("message", { data: new ArrayBuffer(8) });
});

test("rate limits: per-socket message bucket, per-IP room creation, per-IP WebSocket upgrades", async () => {
  const env = makeEnv();
  const code = await newRoom(env);
  const h = await connect(env, code, { name: "Host", pid: "hostpid1", proto: "2" });
  const p = await connect(env, code, { name: "Peer", pid: "peerpid1", proto: "2" });
  const n = h.all("msg").length;
  for (let i = 0; i < 200; i++) await p.msg({ t: "relay", d: { k: "aim", ti: 0, angle: i } });
  const got = h.all("msg").length - n;
  assert.ok(got >= LIMITS.burst && got < LIMITS.burst + 15, "delivered " + got);
  for (let i = 0; i < LIMITS.dropClose; i++) await p.msg({ t: "ping" });
  assert.equal(p.closed && p.closed.code, 4029);
  // room creation: roomPerMin per IP, then 429 with retry-after; a different IP is unaffected
  const env2 = makeEnv();
  for (let i = 0; i < LIMITS.roomPerMin; i++) assert.equal((await createRoom(env2, {}, "5.5.5.5")).status, 200);
  const r = await createRoom(env2, {}, "5.5.5.5");
  assert.equal(r.status, 429); assert.ok(+r.headers.get("retry-after") > 0);
  assert.equal((await createRoom(env2, {}, "5.5.5.6")).status, 200);
  // oversized body
  const big = await createRoom(env2, { pad: "x".repeat(2000) }, "5.5.5.7");
  assert.equal(big.status, 413);
  // WebSocket upgrades per IP per room
  const code2 = await newRoom(env2);
  let last;
  for (let i = 0; i <= LIMITS.wsPerMin; i++) last = await connect(env2, code2, { pid: "spam" + i, proto: "2" }, "7.7.7.7");
  assert.equal(last.closed.code, 4029);
});

test("Room.init exhaustion (8x 409): quick match sends no matched, requeues players, then retries", async () => {
  let fail = true;
  const env = makeEnv({ initFail: () => (fail ? 409 : 0) });
  const socks = [];
  for (let i = 0; i < 4; i++) { await worker.fetch(ws("/ws/quick", { name: "P" + i, pid: "quick" + i, proto: "2" }, "2.2.2." + i), env); socks.push(lastServer); }
  await flush(); await flush();
  const lobby = env.lobby();
  assert.equal(env.inits, 8);
  assert.ok(socks.every((s) => s.all("matched").length === 0), "matched sent for an invalid room");
  assert.equal(lobby.queue.length, 4, "players requeued");
  assert.ok(socks.every((s) => s.last("err") && s.last("err").code === "retry"));
  // the retry succeeds once rooms can be made again
  fail = false;
  clearTimeout(lobby.retryT); lobby.retryT = null;
  await lobby.launch();
  const codes = socks.map((s) => s.last("matched") && s.last("matched").code);
  assert.ok(codes[0] && codes.every((c) => c === codes[0]));
  assert.ok(env.rooms.get(codes[0]).s, "matched room exists");
});

test("Room.init 503 / network failure 3 launches in a row: visible error and close, no matched", async () => {
  const env = makeEnv({ initFail: (n) => (n % 2 ? 503 : "throw") });
  const socks = [];
  for (let i = 0; i < 4; i++) { await worker.fetch(ws("/ws/quick", { pid: "q" + i }, "3.3.3." + i), env); socks.push(lastServer); }
  await flush();
  const lobby = env.lobby();
  for (let k = 0; k < 2; k++) { clearTimeout(lobby.retryT); lobby.retryT = null; await lobby.launch(); }
  clearTimeout(lobby.retryT); lobby.retryT = null;
  assert.equal(env.inits, 24);
  assert.ok(socks.every((s) => s.all("matched").length === 0));
  assert.ok(socks.every((s) => s.last("err").code === "busy" && s.closed.code === 1013));
});

test("POST /api/room: 8x 409 gives 503, never a code", async () => {
  const env = makeEnv({ initFail: () => 409 });
  const r = await createRoom(env, {});
  assert.equal(r.status, 503); assert.equal((await r.json()).code, undefined);
});

test("normal quick match: 4 players get the same initialised room", async () => {
  const env = makeEnv();
  const socks = [];
  for (let i = 0; i < 4; i++) { await worker.fetch(ws("/ws/quick", { pid: "n" + i, ver: "1.15" }, "4.4.4." + i), env); socks.push(lastServer); }
  await flush(); await flush();
  const code = socks[0].last("matched").code;
  assert.ok(socks.every((s) => s.last("matched").code === code));
  const room = env.rooms.get(code);
  assert.equal(room.s.max, 4); assert.equal(room.s.public, true);
  assert.equal(env.lobby().queue.length, 0);
  await new Promise((r) => setTimeout(r, 550));
  assert.ok(socks.every((s) => s.closed && s.closed.code === 1000));
});

test("room size: clamped 2-6 on create, host can change it in the lobby, never below the player count", async () => {
  const env = makeEnv();
  let r = await createRoom(env, { max: 10 }); assert.equal((await r.json()).max, 6);
  r = await createRoom(env, { max: 1 }); assert.equal((await r.json()).max, 2);
  const code = await newRoom(env, { max: 4 });
  const h = await connect(env, code, { pid: "hostpid1", proto: "2" });
  await connect(env, code, { pid: "p2xxxx" }); await connect(env, code, { pid: "p3xxxx" });
  await h.msg({ t: "max", v: 6 }); assert.equal(h.last("roster").max, 6);
  await h.msg({ t: "max", v: 2 }); assert.equal(h.last("roster").max, 3);
  for (let i = 4; i <= 6; i++) await connect(env, code, { pid: "pp" + i + "xxx" });
  const full = await connect(env, code, { pid: "p7xxxx" });
  assert.equal(full.closed.code, 4008);
});

test("protocol: v1.15 (no proto) is accepted as proto 1; reserved pid 'server' is replaced", async () => {
  const env = makeEnv();
  const code = await newRoom(env);
  const a = await connect(env, code, { name: "Old", pid: "oldpid", ver: "1.15" });
  assert.equal(a.readyState, 1); assert.equal(a.last("roster").players[0].proto, 1);
  const s = await connect(env, code, { name: "S", pid: "server" });
  assert.notEqual(s.last("hello").pid, "server");
  const health = await (await worker.fetch(new Request("https://x/health"), env)).json();
  assert.equal(health.proto, 2); assert.equal(health.minProto, 1);
});

test("CORS: known origins (incl. Android file:// 'null') are echoed, others get none", async () => {
  const env = makeEnv();
  const o = async (origin) => (await createRoom(env, {}, "8.8.8." + Math.floor(Math.random() * 250), origin)).headers.get("access-control-allow-origin");
  assert.equal(await o("https://tanks.yishaik.com"), "https://tanks.yishaik.com");
  assert.equal(await o("https://scorched-tanks.yishai-k.workers.dev"), "https://scorched-tanks.yishai-k.workers.dev");
  assert.equal(await o("null"), "null");
  assert.equal(await o("http://localhost:8000"), "http://localhost:8000");
  assert.equal(await o("https://evil.example"), null);
  assert.equal(await o(undefined), null);
  const pre = await worker.fetch(new Request("https://x/api/room", { method: "OPTIONS", headers: { Origin: "null" } }), env);
  assert.equal(pre.headers.get("access-control-allow-origin"), "null");
  const any = await worker.fetch(new Request("https://x/api/room", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }), { ...env, CORS_ANY: "1" });
  assert.equal(any.headers.get("access-control-allow-origin"), "*");
});

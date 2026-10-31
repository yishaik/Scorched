// The Net layer (first inline script of game/index.html) in a VM: proto param, rejoin token storage and reuse.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { inlineScripts } from "./helpers/extract.mjs";

function boot(seed = {}) {
  const ls = new Map(Object.entries(seed));
  const sockets = [];
  class FakeWS { constructor(u) { this.url = u; this.readyState = 0; sockets.push(this); } send() {} close() { this.readyState = 3; } }
  const win = { addEventListener() {} };
  const ctx = {
    window: win, WebSocket: FakeWS, console, setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {}, Uint8Array, Date, Math, JSON, String, Array, Object,
    crypto: globalThis.crypto, fetch: async () => ({ ok: false }),
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) },
  };
  ctx.window.crypto = ctx.crypto;
  vm.createContext(ctx);
  const net = inlineScripts().find((s) => s.includes("const NET_BASE"));
  vm.runInContext(net, ctx);
  return { Net: ctx.window.Net, ls, sockets };
}

test("room URL carries proto=2 and no token on first join; hello token is stored and reused on reconnect", () => {
  const { Net, ls, sockets } = boot({ "st-pid": "abcdef123456" });
  assert.equal(Net.proto, 2);
  Net.connect("ABCD");
  const u1 = new URL(sockets[0].url);
  assert.equal(u1.searchParams.get("proto"), "2");
  assert.equal(u1.searchParams.get("pid"), "abcdef123456");
  assert.equal(u1.searchParams.get("tok"), null);
  sockets[0].readyState = 1; sockets[0].onopen();
  sockets[0].onmessage({ data: JSON.stringify({ t: "hello", pid: "abcdef123456", code: "ABCD", tok: "0123456789abcdef0123456789abcdef", proto: 2 }) });
  assert.match(ls.get("st-tok"), /0123456789abcdef0123456789abcdef/);
  Net.connect("ABCD");
  assert.equal(new URL(sockets[1].url).searchParams.get("tok"), "0123456789abcdef0123456789abcdef");
  // another room: no token sent
  Net.connect("WXYZ");
  assert.equal(new URL(sockets[2].url).searchParams.get("tok"), null);
  // quick match never carries a token
  Net.quick();
  assert.equal(new URL(sockets[3].url).searchParams.get("tok"), null);
  assert.equal(new URL(sockets[3].url).searchParams.get("proto"), "2");
});

test("expired and malformed tokens are dropped; at most 8 rooms kept", () => {
  const old = { ABCD: { t: "0123456789abcdef0123", at: Date.now() - 13 * 3600 * 1000 } };
  const { Net, sockets, ls } = boot({ "st-pid": "abcdef123456", "st-tok": JSON.stringify(old) });
  Net.connect("ABCD");
  assert.equal(new URL(sockets[0].url).searchParams.get("tok"), null);
  for (let i = 0; i < 10; i++) {
    const code = "AAA" + "BCDEFGHJKL"[i];
    Net.connect(code);
    const s = sockets[sockets.length - 1];
    s.readyState = 1; s.onopen();
    s.onmessage({ data: JSON.stringify({ t: "hello", code, tok: "ff".repeat(16) }) });
  }
  assert.equal(Object.keys(JSON.parse(ls.get("st-tok"))).length, 8);
  const s = sockets[sockets.length - 1];
  s.onmessage({ data: JSON.stringify({ t: "hello", code: "QQQQ", tok: "<script>" }) });
  assert.ok(!ls.get("st-tok").includes("script"));
});

test("every inline script parses", () => {
  for (const s of inlineScripts()) new vm.Script(s);
});

// Game logic pulled out of game/index.html and run in Node: shop validation (#16), decor snapshots (#24), room size UI (#23).
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { html, inlineScripts, block } from "./helpers/extract.mjs";

const game = inlineScripts().find((s) => s.includes("const WEAPONS = ["));
// the shop tables exactly as the game builds them (unit prices since v1.14), plus the shop functions
const shopSrc = [
  block(game, "const WEAPONS = ["),
  block(game, "const SHOP = {"),
  block(game, "WEAPONS.forEach((w) => { const s = SHOP"),
  block(game, "const ITEMS = ["),
  block(game, "[WEAPONS, ITEMS].forEach((list) =>"),
  block(game, "function buy(p, i)"),
  block(game, "function sell(p, i)"),
  block(game, "function buyItem(p, k)"),
  block(game, "function sellItem(p, k)"),
  block(game, "function shopLegal("),
].join("\n");
const S = vm.createContext({});
vm.runInContext(shopSrc + "\nthis.api = { WEAPONS, ITEMS, buy, sell, buyItem, sellItem, shopLegal };", S);
const { WEAPONS, ITEMS, buy, sell, buyItem, sellItem, shopLegal } = S.api;
const legal = (b, m) => shopLegal(b, m, WEAPONS, ITEMS);

const base = () => ({ cash: 20000, stock: WEAPONS.map((w) => (w.stock === -1 ? -1 : 2)), items: ITEMS.map(() => 1) });
const clone = (p) => ({ cash: p.cash, stock: p.stock.slice(), items: p.items.slice() });
const MISSILE = WEAPONS.findIndex((w) => w.name === "Missile"), NUKE = WEAPONS.findIndex((w) => w.name === "Nuke");
const BABY = WEAPONS.findIndex((w) => w.stock === -1);
const SHIELD = ITEMS.findIndex((i) => i.id === "shield");

test("price tables: unit prices, bundle 1, CPU pack kept", () => {
  assert.equal(WEAPONS[MISSILE].bundle, 1);
  assert.equal(WEAPONS[MISSILE].price, Math.round(1875 / 10 / 5));
  assert.equal(WEAPONS[MISSILE].pack, 5);
  assert.ok(!WEAPONS[BABY].price);
});

test("normal buys, sells and mixed shopping are accepted", () => {
  const b = base();
  const p = clone(b);
  buy(p, MISSILE); buy(p, MISSILE); buy(p, NUKE); buyItem(p, SHIELD); sell(p, MISSILE + 1); sellItem(p, 0);
  assert.equal(legal(b, p), true);
  assert.equal(legal(b, clone(b)), true, "nothing bought");
  // spending everything
  const q = clone(b); while (q.cash >= WEAPONS[NUKE].price) buy(q, NUKE);
  assert.equal(legal(b, q), true);
  // buy then sell back the same item: loses money, still legal
  const r = clone(b); buy(r, NUKE); sell(r, NUKE);
  assert.ok(r.cash < b.cash); assert.equal(legal(b, r), true);
});

test("random legal shopping sessions (including CPU-style pack buys) are always accepted", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let n = 0; n < 500; n++) {
    const b = base(); b.cash = Math.floor(rnd() * 60000);
    const p = clone(b);
    for (let k = 0; k < 40; k++) {
      const i = Math.floor(rnd() * WEAPONS.length), j = Math.floor(rnd() * ITEMS.length), op = rnd();
      if (op < 0.3) buy(p, i); else if (op < 0.45) sell(p, i);
      else if (op < 0.7) buyItem(p, j); else if (op < 0.85) sellItem(p, j);
      else for (let c = 0; c < (WEAPONS[i].pack || 1); c++) buy(p, i);
    }
    assert.equal(legal(b, p), true, "legal session rejected at " + n);
  }
});

test("forged free stock, overspend and sale fraud are rejected", () => {
  const b = base();
  const free = clone(b); free.stock[NUKE] += 5; assert.equal(legal(b, free), false, "free stock");
  const freeItem = clone(b); freeItem.items[SHIELD] += 1; assert.equal(legal(b, freeItem), false, "free item");
  const over = clone(b); buy(over, NUKE); over.cash += 1; assert.equal(legal(b, over), false, "kept 1 extra cash");
  const sale = clone(b); sell(sale, NUKE); sale.cash += WEAPONS[NUKE].price; assert.equal(legal(b, sale), false, "sold at full price");
  const more = clone(b); more.cash = b.cash + 1; assert.equal(legal(b, more), false, "cash from nowhere");
  const broke = { cash: 0, stock: b.stock.slice(), items: b.items.slice() };
  const owe = clone(broke); owe.stock[MISSILE] += 1; assert.equal(legal(broke, owe), false, "buy with no cash");
});

test("negative, fractional, non-numeric and malformed values are rejected", () => {
  const b = base();
  const neg = clone(b); neg.stock[MISSILE] = -1; assert.equal(legal(b, neg), false);
  const frac = clone(b); frac.items[0] = 0.5; frac.cash = b.cash; assert.equal(legal(b, frac), false);
  const fcash = clone(b); fcash.cash = b.cash - 0.5; assert.equal(legal(b, fcash), false);
  const str = clone(b); str.stock[MISSILE] = "3"; assert.equal(legal(b, str), false);
  const nan = clone(b); nan.cash = NaN; assert.equal(legal(b, nan), false);
  const ncash = clone(b); ncash.cash = -1; assert.equal(legal(b, ncash), false);
  const short = clone(b); short.items.pop(); assert.equal(legal(b, short), false);
  const unl = clone(b); unl.stock[BABY] = 99; assert.equal(legal(b, unl), false, "unlimited weapon changed");
  assert.equal(legal(undefined, clone(b)), false, "no base (unknown pid)");
  assert.equal(legal(b, null), false);
});

test("netShopValid uses shopLegal against netShopBase (kept by every device for host migration)", () => {
  const fn = block(game, "function netShopValid(");
  assert.match(fn, /shopLegal\(netShopBase\[m\.pid\], m, WEAPONS, ITEMS\)/);
  const open = block(game, "function netShopOpen(");
  assert.match(open, /netShopBase\[p\.pid\] = \{ cash: p\.cash, stock: p\.stock\.slice\(\), items: p\.items\.slice\(\) \}/);
  const close = block(game, "function netShopClose(");
  assert.match(close, /netShopValid\(m\)/);
});

// ---- decor (#24)
const D = vm.createContext({});
vm.runInContext(['const DECOR_T = ["tree", "bush", "wreck"];', block(game, "const DECOR_MAX"), block(game, "function decorPack("), block(game, "function decorRead(")].join("\n") + "\nthis.api = { decorPack, decorRead };", D);
const { decorPack, decorRead } = D.api;

test("decor: burnt flags survive serialize -> JSON -> restore", () => {
  const decor = [
    { x: 10.5, t: "tree", v: 0.25, burnt: true },
    { x: 300, t: "bush", v: 0.9, burnt: false },
    { x: 799.9, t: "wreck", v: 0, burnt: true },
  ];
  const wire = JSON.parse(JSON.stringify({ decor: decorPack(decor) }));
  assert.deepEqual(JSON.parse(JSON.stringify(decorRead(wire.decor, 800))), decor);
  assert.ok(JSON.stringify(wire).length < 200);
});

test("decor: missing or bad data falls back (null), size is bounded", () => {
  assert.equal(decorRead(undefined, 800), null, "v1.15 state / old save: regenerate as before");
  assert.equal(decorRead([[10, 9, 0.5, 0]], 800), null, "unknown type");
  assert.equal(decorRead([[900, 0, 0.5, 0]], 800), null, "off the world");
  assert.equal(decorRead([[10, 0, "x", 0]], 800), null);
  assert.equal(decorRead([[10, 0]], 800), null);
  assert.equal(decorRead(new Array(201).fill([1, 0, 0.5, 0]), 800), null);
  assert.equal(decorPack(new Array(500).fill({ x: 1, t: "tree", v: 0.1, burnt: false })).length, 200);
});

test("decor is wired into serializeState and applyState", () => {
  assert.match(block(game, "function serializeState("), /decor: decorPack\(decor\)/);
  const apply = block(game, "function applyState(");
  assert.match(apply, /const dk = decorRead\(d\.decor, TW\);\s*if \(dk\) decor = dk; else genDecor\(/);
  // TW is the restored world width by then
  assert.ok(apply.indexOf("TW = d.TW") < apply.indexOf("decorRead(d.decor, TW)"));
});

// ---- room size (#23)
test("online capacity is shown and room creation sends a 2-6 size", () => {
  const h = html();
  assert.match(h, /Online: 2–6 players per room\. Local games: up to 10 tanks\./);
  assert.match(h, /Play with anyone · 2–4 players/);
  const net = inlineScripts().find((s) => s.includes("const NET_BASE"));
  const sent = [];
  const ctx = {
    window: {}, console, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, Uint8Array, crypto: globalThis.crypto,
    WebSocket: class { constructor() { this.readyState = 0; } close() {} },
    localStorage: { getItem: () => null, setItem() {} },
    fetch: async (u, o) => { sent.push(JSON.parse(o.body)); return { ok: true, json: async () => ({ code: "ABCD" }) }; },
  };
  ctx.window.addEventListener = () => {};
  vm.createContext(ctx); vm.runInContext(net, ctx);
  return (async () => {
    await ctx.window.Net.createRoom(false, 6); await ctx.window.Net.createRoom(false, 10); await ctx.window.Net.createRoom(false, 1); await ctx.window.Net.createRoom(false);
    assert.deepEqual(sent.map((b) => b.max), [6, 6, 2, 4]);
  })();
});

test("every inline script parses", () => { for (const s of inlineScripts()) new vm.Script(s); });

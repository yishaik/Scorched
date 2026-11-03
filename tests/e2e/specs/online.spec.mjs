// Two browser clients, one LOCAL Worker (wrangler dev, started by playwright.config webServer when ST_ONLINE=1).
// The game's hard-coded production host is rerouted to 127.0.0.1 at the network layer; any other request to
// production fails the test. Never runs against the live service.
import { test, expect, devices } from "@playwright/test";

const WORKER = `127.0.0.1:${+(process.env.ST_WORKER_PORT || 8787)}`;
const PROD_HOST = "scorched-tanks.yishai-k.workers.dev";

async function client(browser, name, testInfo) {
  const ctx = await browser.newContext({ ...devices["Pixel 7"], baseURL: testInfo.project.use.baseURL });
  const errors = [], stray = [];
  // Playwright's connectToServer() can only dial the original URL, so the socket is bridged by hand to the local
  // Worker with Node's WebSocket client. Nothing is ever dialled on the production host.
  await ctx.routeWebSocket(/^wss?:\/\/scorched-tanks\.yishai-k\.workers\.dev\//, (route) => {
    const u = new URL(route.url());
    const up = new WebSocket(`ws://${WORKER}${u.pathname}${u.search}`);
    const pending = [];
    up.onopen = () => { while (pending.length) up.send(pending.shift()); };
    up.onmessage = (e) => route.send(typeof e.data === "string" ? e.data : Buffer.from(e.data));
    up.onclose = (e) => route.close({ code: e.code >= 3000 || e.code === 1000 ? e.code : 1000, reason: e.reason }).catch(() => {});
    up.onerror = () => {};
    route.onMessage((m) => (up.readyState === 1 ? up.send(m) : pending.push(m)));
    route.onClose((code, reason) => { try { up.close(code >= 3000 || code === 1000 ? code : 1000, reason); } catch (e) {} });
  });
  await ctx.route((u) => !/^(127\.0\.0\.1|localhost)$/.test(u.hostname), async (route) => {
    const u = new URL(route.request().url());
    if (/fonts\.(googleapis|gstatic)\.com/.test(u.host)) return route.fulfill({ status: 200, contentType: "text/css", body: "" });
    if (u.host === PROD_HOST && u.pathname.startsWith("/api/")) {
      const r = await route.fetch({ url: `http://${WORKER}${u.pathname}${u.search}` });
      return route.fulfill({ response: r });
    }
    stray.push(u.href);
    return route.abort("blockedbyclient");
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`[${name}] pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`[${name}] console.error: ${m.text()}`); });
  await page.addInitScript((n) => { if (!localStorage.getItem("st-name")) localStorage.setItem("st-name", n); }, name);
  await page.goto("/index.html?test=1");
  await page.locator("#title").click();
  await page.locator("#vsNet").click();
  await expect(page.locator("#netOnline")).toBeVisible();
  return { ctx, page, errors, stray, name };
}
const st = (c) => c.page.evaluate(() => window.__ST_TEST__.state());
async function shopDone(c) {
  await expect(c.page.locator("#shopDone")).toBeVisible({ timeout: 20000 });
  await c.page.locator("#shopDone").click();
  await c.page.locator("#confirmYes").click();
}

test("two clients: create room, join by code, start, shop, play turns in sync", async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const A = await client(browser, "Alice", testInfo);
  const B = await client(browser, "Bob", testInfo);
  try {
    await A.page.locator("#netCreateBtn").click();
    await expect(A.page.locator("#netLobby")).toBeVisible();
    await expect(A.page.locator("#nlCode")).toHaveText(/^[A-Z]{4}$/, { timeout: 15000 });
    const code = (await A.page.locator("#nlCode").textContent()).trim();

    await B.page.locator("#netCode").fill(code);
    await B.page.locator("#netJoinBtn").click();
    await expect(B.page.locator("#netLobby")).toBeVisible();
    await expect(A.page.locator("#nlList")).toContainText("Bob", { timeout: 15000 });
    await expect(B.page.locator("#nlList")).toContainText("Alice");
    expect((await st(A)).net.host).toBe(true);
    expect((await st(B)).net.host).toBe(false);
    await A.page.screenshot({ path: testInfo.outputPath("lobby-host.png") });

    await expect(A.page.locator("#nlStart")).toBeEnabled();
    await A.page.locator("#nlStart").click();
    // shop before round 1 (both at once), then the round starts on both devices
    await shopDone(A);
    await shopDone(B);
    for (const c of [A, B]) await expect.poll(async () => (await st(c)).screen, { timeout: 30000 }).toBe("play");

    const sa = await st(A), sb = await st(B);
    expect(sa.mode).toBe("online");
    expect(sa.round).toBe(1);
    expect(sb.world.maskHash, "both devices built the same terrain").toBe(sa.world.maskHash);
    expect(sb.tanks.map((t) => [t.name, Math.round(t.x)])).toEqual(sa.tanks.map((t) => [t.name, Math.round(t.x)]));

    // three turns: whoever owns the turn aims and fires; both devices must agree afterwards
    for (let k = 0; k < 3; k++) {
      let shooter = null;
      await expect.poll(async () => {
        const [x, y] = [await st(A), await st(B)];
        if (x.state !== "play") return "over";
        shooter = x.myTurn && !x.busy ? A : y.myTurn && !y.busy ? B : null;
        return shooter ? "ready" : "waiting";
      }, { timeout: 30000 }).not.toBe("waiting");
      if (!shooter) break; // round already over
      const fired = await shooter.page.evaluate(() => {
        const T = window.__ST_TEST__, s = T.state(), me = s.tanks[s.turn];
        const foe = s.tanks.find((t) => t.alive && t.i !== s.turn);
        const sol = T.solve(foe.i);
        T.aim({ angle: sol.angle, power: Math.max(10, sol.power - 4) });
        return T.fire();
      });
      expect(fired).toBe(true);
      for (const c of [A, B]) {
        const r = await c.page.evaluate(() => window.__ST_TEST__.waitSettled(30000));
        expect(r.timedOut, `${c.name} settled`).toBe(false);
      }
      // the host's state correction can arrive a moment later; then both views agree
      await expect.poll(async () => {
        const [x, y] = [await st(A), await st(B)];
        return JSON.stringify([y.turn, y.world.maskHash, y.tanks.map((t) => Math.round(t.hp))]) ===
          JSON.stringify([x.turn, x.world.maskHash, x.tanks.map((t) => Math.round(t.hp))]);
      }, { timeout: 15000 }).toBe(true);
    }
    await B.page.screenshot({ path: testInfo.outputPath("online-guest.png") });
  } finally {
    const errs = [...A.errors, ...B.errors];
    const stray = [...A.stray, ...B.stray];
    await A.ctx.close(); await B.ctx.close();
    expect(errs, "console errors / uncaught exceptions").toEqual([]);
    expect(stray.filter((u) => u.includes(PROD_HOST)), "unrouted production requests").toEqual([]);
  }
});

test("joining a room code that does not exist shows an error, no crash", async ({ browser }, testInfo) => {
  const A = await client(browser, "Carol", testInfo);
  try {
    await A.page.locator("#netCode").fill("ZZZZ");
    await A.page.locator("#netJoinBtn").click();
    await expect(A.page.locator("#netDlg")).toBeVisible({ timeout: 15000 });
    await expect(A.page.locator("#ndMsg")).toContainText(/not found|Check the code/i);
  } finally {
    const errs = A.errors.slice();
    await A.ctx.close();
    expect(errs).toEqual([]);
  }
});

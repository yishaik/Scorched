// Shared fixtures: every test fails on uncaught page errors or console errors, and the page can never reach the
// network beyond the local test servers (Google Fonts are answered with an empty stylesheet; anything else aborts).
import { test as base, expect } from "@playwright/test";

export const PROD = /scorched-tanks\.yishai-k\.workers\.dev|tanks\.yishaik\.com/;
const LOCAL = /^(https?|wss?):\/\/(127\.0\.0\.1|localhost)(:\d+)?\//;

export const test = base.extend({
  errors: async ({}, use) => { await use([]); },
  external: async ({}, use) => { await use([]); },
  page: async ({ page, errors, external }, use, testInfo) => {
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`console.error: ${m.text()}`); });
    await page.route((u) => !LOCAL.test(u.href), (route) => {
      const u = route.request().url();
      if (/fonts\.(googleapis|gstatic)\.com/.test(u)) return route.fulfill({ status: 200, contentType: "text/css", body: "" });
      external.push(u);
      return route.abort("blockedbyclient");
    });
    await use(page);
    if (testInfo.status !== testInfo.expectedStatus) {
      try { await testInfo.attach("game-state", { body: JSON.stringify(await state(page), null, 1), contentType: "application/json" }); } catch (e) {}
    }
    const allowed = testInfo.annotations.filter((a) => a.type === "allow-error").map((a) => new RegExp(a.description));
    const bad = errors.filter((e) => !allowed.some((r) => r.test(e)));
    expect(bad, "console errors / uncaught exceptions").toEqual([]);
    expect(external.filter((u) => PROD.test(u)), "requests to production").toEqual([]);
  },
});
export { expect };

export const state = (page) => page.evaluate(() => window.__ST_TEST__.state());

export async function openGame(page, query = "") {
  await page.goto(`/index.html?test=1${query}`);
  await expect.poll(() => page.evaluate(() => typeof window.__ST_TEST__)).toBe("object");
}

export async function toMenu(page) {
  await page.locator("#title").click();
  await expect(page.locator("#menu")).toBeVisible();
}

// menu → setup (cpu | 2p) → Start → shop for each human → DONE → round starts
export async function startLocal(page, { mode = "cpu", seed = 1234, rounds = null, beforeStart = null } = {}) {
  await page.locator(mode === "2p" ? "#vs2p" : "#vsCpu").click();
  await expect(page.locator("#setup")).toBeVisible();
  if (rounds != null) {
    for (let k = 0; k < 10; k++) await page.locator('[data-set="r-"]').click();
    for (let k = 1; k < rounds; k++) await page.locator('[data-set="r+"]').click();
  }
  if (beforeStart) await beforeStart();
  await page.evaluate((s) => window.__ST_TEST__.seed(s), seed);
  await page.locator("#startMatch").click();
}

export async function finishShopping(page) {
  // every human shops in turn; with 2+ humans a "pass the device" card comes first. The shop closes by itself ~1 s
  // after the last DONE, so every click is short and allowed to miss.
  const tap = (sel) => page.locator(sel).click({ timeout: 1500 }).catch(() => {});
  for (let k = 0; k < 40; k++) {
    const s = await state(page);
    if (s.screen === "play") return s;
    const vis = await page.evaluate(() => Object.fromEntries(["shop", "shopHand", "shopConfirm", "shopReady"].map((id) => [id, !document.getElementById(id).hidden])));
    if (vis.shop && vis.shopHand) await tap("#handGo");
    else if (vis.shop && vis.shopConfirm) await tap("#confirmYes");
    else if (vis.shop && !vis.shopReady) {
      await tap("#shopDone");
      await page.locator("#shopConfirm").waitFor({ state: "visible", timeout: 1500 }).catch(() => {});
    } else await page.waitForTimeout(250);
  }
  await expect.poll(async () => (await state(page)).screen, { timeout: 5000 }).toBe("play");
  return state(page);
}

// plays the round through the hook: humans aim with the game's own trajectory model and fire; CPUs run at once
export async function playRound(page, maxTurns = 120) {
  return page.evaluate((maxTurns) => {
    const T = window.__ST_TEST__;
    let s = T.settle();
    for (let k = 0; k < maxTurns && s.state === "play"; k++) {
      if (s.myTurn) {
        const me = s.tanks[s.turn];
        const foes = s.tanks.filter((t) => t.alive && t.i !== s.turn).sort((a, b) => Math.abs(a.x - me.x) - Math.abs(b.x - me.x));
        const sol = T.solve(foes[0].i);
        T.aim({ angle: sol.angle, power: sol.power });
        if (!T.fire()) throw new Error("fire refused on a human turn");
      }
      s = T.settle(120);
    }
    return s;
  }, maxTurns);
}

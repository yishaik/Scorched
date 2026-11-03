import { test, expect, openGame, toMenu, startLocal, finishShopping, state } from "../support/fixtures.mjs";

// each case: localStorage contents before the page loads. The game must load, reach the menu and start a match.
const CASES = {
  "garbage everywhere": {
    "st-save": "{not json", "st-setup": "[1,2", "st-maps": "{\"x\":1}", "st-gfx": "purple", "st-speed": "NaN",
    "st-tracers": "maybe", "st-muted": "{}", "st-online-cfg": "{", "st-tok": "[]", "st-pid": "<script>", "st-name": "\u0000\u0000", "st-room-max": "999",
  },
  "wrong JSON shapes": {
    "st-save": JSON.stringify({ v: 2, cfg: {}, players: [], tanks: [] }),
    "st-setup": JSON.stringify({ cpu: "x", "2p": [null, 5], cfg: { rounds: -5, cash: "lots", wind: "Hurricane" } }),
    "st-maps": JSON.stringify([{ n: 5, h: [1, 2, 3] }, null, { n: "ok", h: Array(160).fill(500), d: [[-1, 9], "x"] }]),
    "st-online-cfg": JSON.stringify([1, 2, 3]),
    "st-tok": JSON.stringify({ ABCD: { t: 5 } }),
  },
  "save with a broken mask": {
    "st-save": JSON.stringify({ v: 2, cfg: { rounds: 3 }, round: 1, turn: 0, players: [{ name: "a", stock: [], items: [] }], tanks: [{ pi: 0 }], TW: 10, TH: 10, mruns: [[1, 2, 3]] }),
  },
  "huge numbers": {
    "st-setup": JSON.stringify({ cpu: Array(500).fill("Shooter"), "2p": Array(50).fill("Human"), cfg: { rounds: 1e9, cash: 1e300 } }),
    "st-save": JSON.stringify({ v: 2, cfg: {}, players: [{}], tanks: [{}], TW: 1e9, TH: 1e9, mruns: [] }),
  },
};

for (const [name, data] of Object.entries(CASES)) {
  test(`malformed localStorage: ${name}`, async ({ page }) => {
    await page.addInitScript((d) => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.clear();
      for (const [k, v] of Object.entries(d)) localStorage.setItem(k, v);
    }, data);
    await openGame(page);
    await toMenu(page);
    if (await page.locator("#contBtn").isVisible()) {
      await page.locator("#contBtn").click();
      // a bad save is dropped with a message, never thrown
      await expect(page.locator("#menu")).toBeVisible();
      await expect(page.locator("#contErr")).toBeVisible();
    }
    await startLocal(page, { mode: "cpu", seed: 3 });
    const s = await finishShopping(page);
    expect(s.screen).toBe("play");
    expect(s.tanks.length).toBeGreaterThanOrEqual(2);
    expect(s.tanks.length).toBeLessThanOrEqual(10);
  });
}

test("full storage quota: saving fails gracefully with a message", async ({ page }) => {
  await page.addInitScript(() => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (window.__quota && this === window.localStorage) throw new DOMException("quota", "QuotaExceededError");
      return orig.call(this, k, v);
    };
  });
  await openGame(page);
  await toMenu(page);
  await page.evaluate(() => (window.__quota = true));
  await startLocal(page, { mode: "cpu", seed: 8 });
  const s = await finishShopping(page);
  expect(s.screen).toBe("play");
  await page.locator("#pauseBtn").click();
  await page.locator("#gmSave").click();
  await expect(page.locator("#gmToast")).toContainText("Save failed");
});

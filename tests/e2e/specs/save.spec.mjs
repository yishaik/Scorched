import { test, expect, openGame, toMenu, startLocal, finishShopping, state } from "../support/fixtures.mjs";

test("save in the game menu, reload, continue restores the match exactly", async ({ page }) => {
  await openGame(page);
  await toMenu(page);
  await startLocal(page, { mode: "cpu", seed: 31337 });
  await finishShopping(page);
  // one exchange of fire so there are craters and damage to restore
  await page.evaluate(() => {
    const T = window.__ST_TEST__;
    let s = T.settle();
    const foe = s.tanks.find((t) => t.i !== s.turn);
    const sol = T.solve(foe.i);
    T.aim({ angle: sol.angle, power: Math.max(10, sol.power - 6) }); // a near miss: crater, game goes on
    T.fire();
    return T.settle();
  });
  const before = await state(page);
  expect(before.state).toBe("play");

  await page.locator("#pauseBtn").click();
  await expect(page.locator("#pause")).toBeVisible();
  await page.locator("#gmSave").click();
  await expect(page.locator("#gmToast")).toContainText("GAME SAVED");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("st-save")));
  expect(saved.v).toBe(2);

  await page.reload();
  await expect.poll(() => page.evaluate(() => typeof window.__ST_TEST__)).toBe("object");
  await toMenu(page);
  await expect(page.locator("#contBtn")).toBeVisible();
  await expect(page.locator("#contMeta")).toContainText(`Round 1 of ${before.rounds}`);
  await page.locator("#contBtn").click();
  const after = await state(page);
  expect(after.screen).toBe("play");
  expect(after.round).toBe(before.round);
  expect(after.turn).toBe(before.turn);
  expect(after.wind).toBe(before.wind);
  expect(after.world.TW).toBe(before.world.TW);
  expect(after.world.TH).toBe(before.world.TH);
  expect(after.world.maskHash, "terrain bitmap restored").toBe(before.world.maskHash);
  expect(after.tanks.map((t) => [t.name, t.hp, Math.round(t.x), Math.round(t.y)])).toEqual(before.tanks.map((t) => [t.name, t.hp, Math.round(t.x), Math.round(t.y)]));
  expect(after.players.map((p) => [p.cash, p.stock, p.items])).toEqual(before.players.map((p) => [p.cash, p.stock, p.items]));
});

import { test, expect, openGame, toMenu, startLocal, finishShopping, state } from "../support/fixtures.mjs";

test("Modern/Classic toggle persists after reload and survives rotation", async ({ page }) => {
  await openGame(page);
  await toMenu(page);
  await page.locator("#vsCpu").click();
  const g = page.locator("#opts [data-gfx]");
  await expect(g).toContainText("Modern");
  await g.click();
  await expect(g).toContainText("Classic");
  expect(await page.evaluate(() => localStorage.getItem("st-gfx"))).toBe("classic");

  await page.reload();
  await toMenu(page);
  expect((await state(page)).gfx).toBe("classic");
  await page.locator("#vsCpu").click();
  await expect(page.locator("#opts [data-gfx]")).toContainText("Classic");

  // in a match, switch back from the game menu; rotate; reload
  await page.evaluate(() => window.__ST_TEST__.seed(5));
  await page.locator("#startMatch").click();
  await finishShopping(page);
  await page.locator("#pauseBtn").click();
  await page.locator("#gmSettings").click();
  await page.locator('[data-gs="gfx"] [data-v="modern"]').click();
  await page.locator("#gmBack").click();
  await page.locator("#resume").click();
  const vp = page.viewportSize();
  await page.setViewportSize({ width: vp.height, height: vp.width });
  await page.waitForTimeout(400);
  expect((await state(page)).gfx).toBe("modern");
  await page.screenshot({ path: test.info().outputPath("modern-rotated.png") });
  await page.reload();
  expect((await state(page)).gfx).toBe("modern");
  expect(await page.evaluate(() => localStorage.getItem("st-gfx"))).toBe("modern");
});

import { test, expect, openGame, toMenu, state } from "../support/fixtures.mjs";

test("loads with no console errors, title → menu, version tag", async ({ page }) => {
  await openGame(page);
  await expect(page.locator("#title")).toBeVisible();
  await page.waitForTimeout(800); // a few title frames (fireworks) run
  await toMenu(page);
  await expect(page.locator("#verTag")).toHaveText(/^v\d+\.\d+$/);
  const s = await state(page);
  expect(s.screen).toBe("menu");
  expect(s.world.SW).toBeGreaterThan(100);
  await page.screenshot({ path: test.info().outputPath("menu.png") });
});

test("without ?test=1 the test hook does not exist", async ({ page }) => {
  await page.goto("/index.html");
  await page.locator("#title").click();
  await expect(page.locator("#menu")).toBeVisible();
  expect(await page.evaluate(() => typeof window.__ST_TEST__)).toBe("undefined");
  expect(await page.evaluate(() => "__ST_TEST__" in window)).toBe(false);
});

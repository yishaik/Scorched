import { test, expect, openGame, toMenu, finishShopping, state } from "../support/fixtures.mjs";

test("map builder: draw ground, place tree/bush/wreck, save, reopen, edit, play on it", async ({ page }) => {
  await openGame(page);
  await toMenu(page);
  await page.locator("#vsCpu").click();
  await page.locator("#opts [data-map]").click();
  await expect(page.locator("#mapPick")).toBeVisible();
  await page.locator("#mpNew").click();
  await expect(page.locator("#mapEd")).toBeVisible();
  const cv = page.locator("#meCv");
  await expect.poll(async () => (await cv.boundingBox())?.width || 0).toBeGreaterThan(50);
  const b = await cv.boundingBox();

  // draw: a high plateau on the left third
  await page.mouse.move(b.x + 2, b.y + b.height * 0.2);
  await page.mouse.down();
  for (let k = 1; k <= 20; k++) await page.mouse.move(b.x + (b.width / 3) * (k / 20), b.y + b.height * 0.2);
  await page.mouse.up();

  // scenery: tree, bush, wreck at different spots
  const place = async (tool, fx) => {
    await page.locator(`#meTools [data-tool="${tool}"]`).click();
    await cv.click({ position: { x: b.width * fx, y: b.height * 0.5 } });
  };
  await place("0", 0.15);
  await place("1", 0.5);
  await place("2", 0.85);

  await page.locator("#meName").fill("E2E Map");
  await page.locator("#meSave").click();
  await expect(page.locator("#mapEd")).toBeHidden();
  await expect(page.locator("#mpList")).toContainText("E2E Map");

  const maps = await page.evaluate(() => JSON.parse(localStorage.getItem("st-maps")));
  expect(maps).toHaveLength(1);
  const m = maps[0];
  expect(m.n).toBe("E2E Map");
  expect(m.h).toHaveLength(160);
  expect(Math.max(...m.h.slice(5, 45)), "drawn plateau is high").toBeGreaterThan(70);
  expect(m.d.map((d) => d[1]).sort()).toEqual([0, 1, 2]);

  // reopen: EDIT shows the same map; remove the bush by tapping it again; save
  await page.locator('#mpList [data-mpe="0"]').click();
  await expect(page.locator("#mapEd")).toBeVisible();
  await expect(page.locator("#meName")).toHaveValue("E2E Map");
  await page.locator('#meTools [data-tool="1"]').click();
  await cv.click({ position: { x: b.width * 0.5, y: b.height * 0.5 } });
  await page.locator("#meSave").click();
  const maps2 = await page.evaluate(() => JSON.parse(localStorage.getItem("st-maps")));
  expect(maps2).toHaveLength(1);
  expect(maps2[0].d.map((d) => d[1]).sort()).toEqual([0, 2]);
  expect(maps2[0].h).toEqual(m.h);

  // survives a reload, then pick it and play on it
  await page.reload();
  await toMenu(page);
  await page.locator("#vsCpu").click();
  await page.locator("#opts [data-map]").click();
  await expect(page.locator("#mpList")).toContainText("E2E Map");
  await page.locator('#mpList [data-mp="0"]').click();
  await expect(page.locator("#opts [data-map]")).toContainText("E2E Map");
  await page.evaluate(() => window.__ST_TEST__.seed(11));
  await page.locator("#startMatch").click();
  const s = await finishShopping(page);
  expect(s.screen).toBe("play");
  await page.waitForTimeout(300);
  await page.screenshot({ path: test.info().outputPath("custom-map.png") });
});

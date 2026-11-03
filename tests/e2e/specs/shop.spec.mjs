import { test, expect, openGame, toMenu, startLocal, finishShopping, state } from "../support/fixtures.mjs";

test("shop before round 1: tap-to-buy, hold-to-buy, sell, inventory carries into the round", async ({ page }) => {
  await openGame(page);
  await toMenu(page);
  await startLocal(page, { mode: "cpu", seed: 7 });
  await expect(page.locator("#shop")).toBeVisible();
  const W = await page.evaluate(() => window.__ST_TEST__.weapons());
  const mi = W.findIndex((w) => w.name === "Missile");
  const price = W[mi].price;
  expect(price).toBeGreaterThan(0);
  const me = async () => (await state(page)).players.find((p) => p.type === "Human");

  const p0 = await me();
  expect(p0.cash).toBe(10000);
  const buyBtn = page.locator(`#shopList [data-buy="${mi}"]`);
  await buyBtn.scrollIntoViewIfNeeded();
  await buyBtn.click();
  const p1 = await me();
  expect(p1.stock[mi]).toBe(1);
  expect(p1.cash).toBe(10000 - price);
  await expect(page.locator("#shopCash")).toHaveText("$" + (10000 - price).toLocaleString("en-US"));

  // hold: repeats after ~380 ms, faster as it goes
  const box = await page.locator(`#shopList [data-buy="${mi}"]`).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1600);
  await page.mouse.up();
  const p2 = await me();
  expect(p2.stock[mi], "hold-to-buy should buy several").toBeGreaterThanOrEqual(p1.stock[mi] + 4);
  expect(p2.cash).toBe(10000 - price * p2.stock[mi]);

  // sell one back for half price
  await page.locator(`#shopList [data-sell="${mi}"]`).click();
  const p3 = await me();
  expect(p3.stock[mi]).toBe(p2.stock[mi] - 1);
  expect(p3.cash).toBe(p2.cash + Math.floor(price / 2));

  // misc tab: a parachute
  await page.locator('#shop [data-tab="m"]').click();
  const IT = await page.evaluate(() => window.__ST_TEST__.items());
  const ci = IT.findIndex((x) => x.id === "chute");
  await page.locator(`#shopList [data-ibuy="${ci}"]`).click();
  const p4 = await me();
  expect(p4.items[ci]).toBe(1);

  await page.locator("#shopDone").click();
  await expect(page.locator("#confirmSum")).toContainText("Bought:");
  await page.locator("#confirmYes").click();
  const s = await finishShopping(page);
  const t = s.players.find((p) => p.type === "Human");
  expect(t.stock[mi]).toBe(p3.stock[mi]);
  expect(t.items[ci]).toBe(1);
  expect(t.cash).toBe(p4.cash);
});

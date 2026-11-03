import { test, expect, openGame, toMenu, startLocal, finishShopping, state } from "../support/fixtures.mjs";

const key = (s) => ({ W: s.world.W, H: s.world.H, TW: s.world.TW, TH: s.world.TH, mask: s.world.maskHash, tanks: s.tanks.map((t) => [t.x, t.y, t.hp]) });

test("rotation mid-round (after a crater and mid-shot) keeps the world: no stretch, no reseed", async ({ page }) => {
  await openGame(page);
  await toMenu(page);
  await startLocal(page, { mode: "2p", seed: 2024 });
  await finishShopping(page);
  // crater first
  await page.evaluate(() => {
    const T = window.__ST_TEST__, s = T.settle();
    T.aim({ angle: s.tanks[s.turn].x < s.world.W / 2 ? 60 : 120, power: 45 });
    T.fire();
    return T.settle();
  });
  const a = await state(page);
  expect(a.state).toBe("play");
  const vp = page.viewportSize();

  await page.setViewportSize({ width: vp.height, height: vp.width });
  await page.waitForTimeout(500);
  const b = await state(page);
  expect(key(b)).toEqual(key(a));
  expect([b.world.SW, b.world.SH]).not.toEqual([a.world.SW, a.world.SH]);
  expect(b.world.VS, "world is letterboxed, uniformly scaled").toBeLessThan(1.0001);
  await page.screenshot({ path: test.info().outputPath("rotated.png") });

  // rotate while a shot is in the air
  await page.evaluate(() => { const T = window.__ST_TEST__, s = T.state(); T.aim({ angle: s.tanks[s.turn].x < s.world.W / 2 ? 70 : 110, power: 70 }); T.fire(); });
  expect((await state(page)).busy).toBe(true);
  await page.setViewportSize(vp);
  await page.waitForTimeout(300);
  const c = await page.evaluate(() => window.__ST_TEST__.waitSettled(30000));
  expect(c.timedOut).toBe(false);
  expect(c.world.W).toBe(a.world.W);
  expect(c.world.H).toBe(a.world.H);
  expect(c.world.TW).toBe(a.world.TW);
  expect(c.world.TH).toBe(a.world.TH);
  // back at the original viewport: same stage width, and the view is the uniform fit of the unchanged world
  const d = await state(page);
  expect(d.world.SW).toBe(a.world.SW);
  const fit = Math.min(d.world.SW / d.world.W, d.world.SH / d.world.H);
  expect(Math.abs(d.world.VS - fit)).toBeLessThan(1e-6);
  if (d.world.H !== d.world.SH || d.world.W !== d.world.SW) {
    test.info().annotations.push({ type: "observation", description: `world ${d.world.W}x${d.world.H} vs settled stage ${d.world.SW}x${d.world.SH}: round world was sized before the stage settled` });
  }
});

test("rotation on the menu regenerates the backdrop for the new size (no stale world)", async ({ page }) => {
  await openGame(page);
  await toMenu(page);
  const a = await state(page);
  const vp = page.viewportSize();
  await page.setViewportSize({ width: vp.height, height: vp.width });
  await page.waitForTimeout(400);
  const b = await state(page);
  expect(b.world.W).toBe(b.world.SW);
  expect(b.world.H).toBe(b.world.SH);
  expect(b.world.W).not.toBe(a.world.W);
});

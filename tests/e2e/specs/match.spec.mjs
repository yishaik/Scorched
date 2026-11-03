import { test, expect, openGame, toMenu, startLocal, finishShopping, playRound, state } from "../support/fixtures.mjs";

for (const mode of ["cpu", "2p"]) {
  test(`local ${mode} game plays to a round winner, then on to round 2`, async ({ page }) => {
    await openGame(page);
    await toMenu(page);
    await startLocal(page, { mode, seed: 4242, rounds: 2 });
    const s0 = await finishShopping(page);
    expect(s0.round).toBe(1);
    expect(s0.tanks).toHaveLength(2);
    expect(s0.tanks.every((t) => t.hp === 100)).toBe(true);
    if (mode === "cpu") expect(s0.tanks.filter((t) => t.cpu)).toHaveLength(1);
    else expect(s0.tanks.filter((t) => t.cpu)).toHaveLength(0);

    const s1 = await playRound(page);
    expect(s1.state, "round should end").toBe("over");
    await expect(page.locator("#win")).toBeVisible();
    await expect(page.locator("#winText")).toHaveText(/ wins$|^Draw$/);
    const alive = s1.tanks.filter((t) => t.alive);
    expect(alive.length).toBeLessThanOrEqual(1);
    if (alive.length === 1) {
      const p = s1.players.find((q) => q.name === alive[0].name);
      expect(p.wins).toBe(1);
      expect(p.cash).toBeGreaterThan(10000);
    }
    await page.screenshot({ path: test.info().outputPath(`winner-${mode}.png`) });

    // round 2: shop again, then play
    await page.locator("#again").click();
    const s2 = await finishShopping(page);
    expect(s2.round).toBe(2);
    const s3 = await playRound(page);
    expect(s3.state).toBe("over");
    await expect(page.locator("#again")).toHaveText("Final standings");
    await page.locator("#again").click();
    await expect(page.locator("#stand")).toBeVisible();
    await expect(page.locator("#standTitle")).toHaveText(/wins the match|tie/);
  });
}

test("10-tank CPU game (1 human + 9 CPUs) resolves a round", async ({ page }) => {
  await openGame(page);
  await toMenu(page);
  await startLocal(page, {
    mode: "cpu", seed: 99, rounds: 1,
    beforeStart: async () => { for (let k = 0; k < 8; k++) await page.locator('[data-set="n+"]').click(); },
  });
  const s0 = await finishShopping(page);
  expect(s0.tanks).toHaveLength(10);
  const s1 = await playRound(page, 400);
  expect(s1.state).toBe("over");
  await expect(page.locator("#winText")).toHaveText(/ wins$|^Draw$/);
});

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


// Sample the main game canvas in normalised 0..1 coordinates (css pixels via the bitmap).
async function sample(page, points) {
  return page.evaluate((pts) => {
    const c = document.getElementById("cv");
    const ctx = c.getContext("2d");
    return pts.map(([x, y]) => {
      const px = Math.max(0, Math.min(c.width - 1, Math.round(x * c.width)));
      const py = Math.max(0, Math.min(c.height - 1, Math.round(y * c.height)));
      const d = ctx.getImageData(px, py, 1, 1).data;
      return { r: d[0], g: d[1], b: d[2], a: d[3], x: px, y: py };
    });
  }, points);
}

async function scanBand(page, y0, y1, pred) {
  return page.evaluate(({ y0, y1, predSrc }) => {
    const pred = new Function("p", "return (" + predSrc + ")(p)");
    const c = document.getElementById("cv");
    const ctx = c.getContext("2d");
    const xStep = Math.max(4, Math.floor(c.width / 40));
    const yStep = Math.max(4, Math.floor(c.height / 50));
    let n = 0, hit = 0;
    const first = [];
    for (let y = Math.floor(y0 * c.height); y < y1 * c.height; y += yStep) {
      for (let x = 0; x < c.width; x += xStep) {
        const d = ctx.getImageData(x, y, 1, 1).data;
        const p = { r: d[0], g: d[1], b: d[2] };
        n++;
        if (pred(p)) {
          hit++;
          if (first.length < 3) first.push({ x, y, ...p });
        }
      }
    }
    return { n, hit, first };
  }, { y0, y1, predSrc: pred.toString() });
}

test("modern look has sunset skies and grassy hills; Classic is a different one-tap look", async ({ page }) => {
  await openGame(page);
  await toMenu(page);
  await page.waitForTimeout(400);
  expect((await state(page)).gfx).toBe("modern");
  const sunset = await scanBand(page, 0.05, 0.55, (p) => p.r > 180 && p.g > 70 && p.g < 220 && p.b < 150);
  expect(sunset.hit, "modern sunset / warm sky pixels: " + JSON.stringify(sunset)).toBeGreaterThan(5);
  const grass = await scanBand(page, 0.48, 0.68, (p) => p.g > p.r + 8 && p.g > p.b + 8 && p.g > 70 && p.g < 210);
  expect(grass.hit, "modern grassy hill pixels: " + JSON.stringify(grass)).toBeGreaterThan(8);

  await page.locator("#vsCpu").click();
  await page.locator("#opts [data-gfx]").click();
  await expect(page.locator("#opts [data-gfx]")).toContainText("Classic");
  await page.locator("#setupBack").click();
  await expect(page.locator("#menu")).toBeVisible();
  await page.waitForTimeout(400);
  expect((await state(page)).gfx).toBe("classic");
  const classicGrass = await scanBand(page, 0.48, 0.68, (p) => p.g > p.r + 8 && p.g > p.b + 8 && p.g > 70 && p.g < 210);
  expect(classicGrass.hit, "Classic should not paint green hills: " + JSON.stringify(classicGrass)).toBeLessThan(grass.hit / 2);
});

test("burning trees in the modern look show visible fire", async ({ page }) => {
  await openGame(page);
  await toMenu(page);
  await page.waitForTimeout(200);
  const n = await page.evaluate(() => window.__ST_TEST__.burnTrees());
  expect(n).toBeGreaterThan(0);
  await page.waitForTimeout(400);
  const fire = await page.evaluate(() => {
    const trees = window.__ST_TEST__.decor().filter((d) => d.t === "tree" && d.burnt);
    const c = document.getElementById("cv");
    const ctx = c.getContext("2d");
    const w = c.width, h = c.height;
    let hit = 0, n = 0;
    const first = [];
    const isFire = (r, g, b) => r > 200 && g > 60 && b < 130 && r > b + 50 && r + g > 280;
    trees.forEach((d) => {
      const px = Math.max(2, Math.min(w - 3, Math.round((d.x / (window.innerWidth || w)) * w)));
      // d.x is world pixels; canvas may be CSS-scaled. Use the canvas world: d.x is in game W, canvas is W*dpr.
      const gx = Math.max(2, Math.min(w - 3, Math.round(d.x * (w / c.clientWidth) || d.x)));
    });
    // Prefer mapping via canvas backing store: game world equals CSS size of #cv; backing store is dpr-scaled.
    const sx = w / c.clientWidth, sy = h / c.clientHeight;
    trees.forEach((d) => {
      const cx = Math.round(d.x * sx);
      // find ground from the bottom at this x, then look above it for flames
      let gy = h - 1;
      for (let y = h - 1; y > h * 0.2; y -= 2) {
        const p = ctx.getImageData(Math.max(0, Math.min(w - 1, cx)), y, 1, 1).data;
        // sky/hill pixels sit above dirt; once we leave a run of mid-dark ground, stop. Simpler: just scan a band above mid-lower.
        gy = y;
      }
      const x0 = Math.max(0, cx - Math.round(18 * sx));
      const x1 = Math.min(w - 1, cx + Math.round(18 * sx));
      const y1 = Math.min(h - 1, Math.round(h * 0.98));
      const y0 = Math.max(0, Math.round(h * 0.35));
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x <= x1; x += 2) {
          const p = ctx.getImageData(x, y, 1, 1).data;
          n++;
          if (isFire(p[0], p[1], p[2])) {
            hit++;
            if (first.length < 4) first.push({ x, y, r: p[0], g: p[1], b: p[2] });
          }
        }
      }
    });
    return { n, hit, first, trees: trees.length };
  });
  expect(fire.trees).toBeGreaterThan(0);
  expect(fire.hit, "burning-tree fire pixels: " + JSON.stringify(fire)).toBeGreaterThan(3);
});

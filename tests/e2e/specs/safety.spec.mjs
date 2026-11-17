import { test, expect, openGame, toMenu, state } from "../support/fixtures.mjs";

// First-launch age gate, parent PIN and the safety reminder before online play.
// These tests use a clean localStorage (no default adult seed).

async function fresh(page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("st-safety-seeded")) return;
    sessionStorage.setItem("st-safety-seeded", "1");
    localStorage.clear();
  });
  await openGame(page);
}

async function enterPin(page, pin) {
  for (const d of String(pin).split("")) {
    await page.locator(`#pinPad [data-pin="${d}"]`).click();
  }
}

test("first launch shows the age gate after the title; picking 18+ reaches the menu", async ({ page }) => {
  await fresh(page);
  await expect(page.locator("#title")).toBeVisible();
  await page.locator("#title").click();
  await expect(page.locator("#ageGate")).toBeVisible();
  expect((await state(page)).screen).toBe("ageGate");
  expect((await state(page)).safety.age).toBe("");
  await page.locator("#ageAdult").click();
  await expect(page.locator("#menu")).toBeVisible();
  const s = await state(page);
  expect(s.screen).toBe("menu");
  expect(s.safety.age).toBe("adult");
  expect(s.safety.allowOnline).toBe(true);
  expect(s.safety.hasPin).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem("st-age"))).toBe("adult");
});

test("under 13 requires a parent PIN and keeps online play locked until the PIN is entered", async ({ page }) => {
  await fresh(page);
  await page.locator("#title").click();
  await page.locator("#ageU13").click();
  await expect(page.locator("#pinGate")).toBeVisible();
  expect((await state(page)).screen).toBe("pinGate");
  await enterPin(page, "1234");
  await expect(page.locator("#pinMsg")).toContainText("again");
  await enterPin(page, "1234");
  await expect(page.locator("#menu")).toBeVisible();
  let s = await state(page);
  expect(s.safety.age).toBe("u13");
  expect(s.safety.allowOnline).toBe(false);
  expect(s.safety.hasPin).toBe(true);
  expect(s.safety.restrictCodes).toBe(true);

  await page.locator("#vsNet").click();
  await expect(page.locator("#pinGate")).toBeVisible();
  await enterPin(page, "0000");
  await expect(page.locator("#pinErr")).toBeVisible();
  expect((await state(page)).safety.allowOnline).toBe(false);
  await enterPin(page, "1234");
  await expect(page.locator("#safetyDlg")).toBeVisible();
  expect((await state(page)).safety.allowOnline).toBe(true);
  await page.locator("#safetyOk").click();
  await expect(page.locator("#netOnline")).toBeVisible();
  // room-code restriction still on by default for the child group
  await expect(page.locator("#netQuickBtn")).toBeHidden();
});

test("mismatched PIN setup stays on the pad and does not store a PIN", async ({ page }) => {
  await fresh(page);
  await page.locator("#title").click();
  await page.locator("#ageU13").click();
  await enterPin(page, "1234");
  await enterPin(page, "4321");
  await expect(page.locator("#pinErr")).toContainText("match");
  expect(await page.evaluate(() => localStorage.getItem("st-pin"))).toBeNull();
  await expect(page.locator("#pinGate")).toBeVisible();
  await page.locator("#pinCancel").click();
  await expect(page.locator("#ageGate")).toBeVisible();
});

test("PLAY ONLINE shows the safety reminder; Back returns to the menu; I Understand opens the panel", async ({ page }) => {
  await fresh(page);
  await page.locator("#title").click();
  await page.locator("#ageAdult").click();
  await page.locator("#vsNet").click();
  await expect(page.locator("#safetyDlg")).toBeVisible();
  expect((await state(page)).screen).toBe("safety");
  await page.locator("#safetyBack").click();
  await expect(page.locator("#menu")).toBeVisible();
  await expect(page.locator("#netOnline")).toBeHidden();
  await page.locator("#vsNet").click();
  await page.locator("#safetyOk").click();
  await expect(page.locator("#netOnline")).toBeVisible();
});

test("parent controls require the PIN; toggles persist; keyboard can enter the PIN", async ({ page }) => {
  await fresh(page);
  await page.locator("#title").click();
  await page.locator("#ageTeen").click();
  await expect(page.locator("#menu")).toBeVisible();
  await page.locator("#parentBtn").click();
  // first visit: set a PIN
  await expect(page.locator("#pinGate")).toBeVisible();
  await page.keyboard.type("2468");
  await expect(page.locator("#pinMsg")).toContainText("again");
  await page.keyboard.type("2468");
  await expect(page.locator("#parentPanel")).toBeVisible();
  expect((await state(page)).screen).toBe("parentControls");
  expect((await state(page)).safety.allowOnline).toBe(true);
  await page.locator("#parentOnline").click();
  expect((await state(page)).safety.allowOnline).toBe(false);
  await page.locator("#parentDone").click();
  await expect(page.locator("#menu")).toBeVisible();
  await page.locator("#parentBtn").click();
  await expect(page.locator("#pinGate")).toBeVisible();
  await page.keyboard.type("2468");
  await expect(page.locator("#parentPanel")).toBeVisible();
  expect((await state(page)).safety.allowOnline).toBe(false);
  await page.locator("#parentCodes").click();
  expect((await state(page)).safety.restrictCodes).toBe(true);
  await page.locator("#parentOnline").click();
  await page.locator("#parentDone").click();
  await page.locator("#vsNet").click();
  await page.locator("#safetyOk").click();
  await expect(page.locator("#netOnline")).toBeVisible();
  await expect(page.locator("#netQuickBtn")).toBeHidden();
});

test("age and PIN settings never trigger a production network request", async ({ page, external }) => {
  await fresh(page);
  await page.locator("#title").click();
  await page.locator("#ageU13").click();
  await enterPin(page, "1357");
  await enterPin(page, "1357");
  await page.locator("#parentBtn").click();
  await enterPin(page, "1357");
  await expect(page.locator("#parentPanel")).toBeVisible();
  const prod = external.filter((u) => /yishai-k\.workers\.dev|tanks\.yishaik\.com/.test(u));
  expect(prod).toEqual([]);
});

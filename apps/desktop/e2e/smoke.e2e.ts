import { expect, test } from "@playwright/test";
import { launchApp } from "./app.ts";
import { copy } from "./copy.ts";
import { startSorting, walkToSetup } from "./onboarding.ts";

// A scan of the small fixture is 483 messages; 20 per 200 ms page keeps it running for several seconds.
const SCAN_PACE_MS = 200;

// "<n> emails sorted so far" while the total is unknown, "<n> of <total> emails sorted" once it is.
const COUNT_LINE = /^[\d,]+ /;

// Guards: a screen of the first-run path that throws, or a Pause/Resume that does not reach the scan.
test("a new user gets from Welcome to the first summary, and can pause and resume sorting", async () => {
  const running = await launchApp({ firstRun: true, scanPaceMs: SCAN_PACE_MS });
  const { page } = running;
  try {
    await test.step("Welcome", async () => {
      await expect(
        page.getByRole("heading", { level: 1, name: copy("welcome.headline") }),
      ).toBeVisible();
    });
    await test.step("Connect the fixture account, then Setup", () => walkToSetup(page));
    await test.step("Overview while sorting: the numbers move", async () => {
      await startSorting(page);
      const line = page.locator('[data-slot="status-finding"]');
      await expect(line).toHaveText(COUNT_LINE);
      const first = (await line.textContent()) ?? "";
      await expect(line).not.toHaveText(first);
    });
    await test.step("Pause holds the scan, Resume carries it on", async () => {
      await page.getByRole("button", { name: copy("overview.pause") }).click();
      const line = page.locator('[data-slot="status-finding"]');
      await expect(line).toHaveText(copy("overview.scan.paused"));
      await page.getByRole("button", { name: copy("overview.resume") }).click();
      await expect(line).toHaveText(COUNT_LINE);
    });
    await test.step("The summary sheet opens when the scan is done, and closes", async () => {
      const sheet = page.getByRole("dialog", { name: copy("summary.title") });
      await expect(sheet).toBeVisible({ timeout: 30_000 });
      // Radix locks the page scroll with a runtime stylesheet that the strict CSP must still let through.
      await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
      await sheet.getByRole("button", { name: copy("action.close") }).click();
      await expect(sheet).toBeHidden();
      await expect(page.getByRole("button", { name: copy("overview.viewSummary") })).toBeVisible();
    });
    expect(running.problems).toEqual([]);
  } finally {
    await running.close();
  }
});

// Guards: the Setup title appearing or disappearing with focus moves the Start button, so a press on its edge misses it.
test("pressing elsewhere on Setup does not move the Start button", async () => {
  const running = await launchApp({ firstRun: true });
  const { page } = running;
  try {
    await walkToSetup(page);
    const start = page.getByRole("button", { name: copy("setup.start") });
    const heading = page.getByRole("heading", { level: 1, name: copy("setup.title") });
    await expect(heading).toBeFocused();
    const before = await start.boundingBox();
    await page.mouse.click(4, 4);
    await expect(heading).not.toBeFocused();
    expect(await start.boundingBox()).toEqual(before);
    expect(running.problems).toEqual([]);
  } finally {
    await running.close();
  }
});

// Guards: Sonner's runtime stylesheet blocked by the strict CSP (style-src 'self'), which leaves every toast unstyled.
test("toast styles apply under the strict CSP", async () => {
  const running = await launchApp();
  const { page } = running;
  try {
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const toastRules = await page.evaluate(
      () =>
        [...document.styleSheets, ...document.adoptedStyleSheets].filter((sheet) =>
          [...sheet.cssRules].some(
            (rule) =>
              rule instanceof CSSStyleRule && rule.selectorText.includes("data-sonner-toast"),
          ),
        ).length,
    );
    expect(toastRules).toBeGreaterThan(0);
    expect(running.problems).toEqual([]);
  } finally {
    await running.close();
  }
});

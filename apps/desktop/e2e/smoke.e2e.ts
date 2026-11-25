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
      await sheet.getByRole("button", { name: copy("action.close") }).click();
      await expect(sheet).toBeHidden();
      await expect(page.getByRole("button", { name: copy("overview.viewSummary") })).toBeVisible();
    });
    expect(running.problems).toEqual([]);
  } finally {
    await running.close();
  }
});

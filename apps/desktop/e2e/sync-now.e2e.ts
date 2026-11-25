import { expect, test } from "@playwright/test";
import { launchApp } from "./app.ts";
import { copy } from "./copy.ts";

// The demo starts with only part of the mailbox stored, so Sync now has mail to bring in; 20 per 200 ms page keeps it running for seconds.
const SCAN_PACE_MS = 200;

// The sidebar's count of alert emails: "Alert emails 79" before the sync, more once the rest of the mailbox is in.
const alertCount = (name: string | null) =>
  Number.parseInt((/([\d,]+)$/.exec(name ?? "")?.[1] ?? "").replace(/,/g, ""), 10);

// Guards: a Sync now that changes nothing on screen, or a button that can be pressed again while it runs.
test("Sync now brings in new mail while its button is disabled, then enables it again", async () => {
  const running = await launchApp({ scanPaceMs: SCAN_PACE_MS });
  const { page } = running;
  try {
    const alerts = page.getByRole("link", {
      name: new RegExp(`^${copy("category.notifications")}`),
    });
    await expect(alerts).toBeVisible();
    const before = alertCount(await alerts.textContent());

    await page.getByRole("button", { name: copy("sync.now") }).click();
    await expect(page.getByRole("button", { name: copy("sync.running") })).toBeDisabled();
    await expect.poll(async () => alertCount(await alerts.textContent())).not.toBe(before);
    // The first summary opens over the app once the mail is in; the button is behind it until it closes.
    const sheet = page.getByRole("dialog", { name: copy("summary.title") });
    await expect(sheet).toBeVisible({ timeout: 30_000 });
    await sheet.getByRole("button", { name: copy("action.close") }).click();
    await expect(page.getByRole("button", { name: copy("sync.now") })).toBeEnabled();
    expect(alertCount(await alerts.textContent())).toBeGreaterThan(before);
    expect(running.problems).toEqual([]);
  } finally {
    await running.close();
  }
});

import { expect, test } from "@playwright/test";
import { launchApp } from "./app.ts";
import { copy } from "./copy.ts";

// The demo starts with only part of the mailbox stored, so Sync now has mail to bring in; 20 per 200 ms page keeps it running for seconds.
const SCAN_PACE_MS = 200;

const emailTotal = (text: string | null) =>
  Number.parseInt((/out of ([\d,]+)/.exec(text ?? "")?.[1] ?? "").replace(/,/g, ""), 10);

// Guards: a Sync now that changes nothing on screen, or a button that can be pressed again while it runs.
test("Sync now brings in new mail while its button is disabled, then enables it again", async () => {
  const running = await launchApp({ scanPaceMs: SCAN_PACE_MS });
  const { page } = running;
  try {
    const figure = page.getByText(/emails you can delete, out of/);
    await expect(figure).toBeVisible();
    const before = emailTotal(await figure.textContent());

    await page.getByRole("button", { name: copy("sync.now") }).click();
    await expect(page.getByRole("button", { name: copy("sync.running") })).toBeDisabled();
    await expect.poll(async () => emailTotal(await figure.textContent())).toBeGreaterThan(before);
    // The first summary opens over the app once the mail is in; the button is behind it until it closes.
    const sheet = page.getByRole("dialog", { name: copy("summary.title") });
    await expect(sheet).toBeVisible({ timeout: 30_000 });
    await sheet.getByRole("button", { name: copy("action.close") }).click();
    await expect(page.getByRole("button", { name: copy("sync.now") })).toBeEnabled();
    expect(running.problems).toEqual([]);
  } finally {
    await running.close();
  }
});

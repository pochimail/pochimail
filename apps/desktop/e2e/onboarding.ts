import { expect, type Page } from "@playwright/test";
import { copy } from "./copy.ts";

/** Welcome → Connect (the fixture account answers instead of Google) → Setup, ready to start sorting. */
export async function walkToSetup(page: Page): Promise<void> {
  await page.getByRole("link", { name: copy("welcome.cta") }).click();
  await page.getByRole("button", { name: copy("connect.gmail") }).click();
  await expect(page.getByRole("button", { name: copy("setup.start") })).toBeVisible();
}

/**
 * Setup's title is visible only while it has focus, so the first press anywhere else hides it and moves the page up by
 * its height: a click that lands on the button's top edge is lost. Focusing the button first lets the layout settle.
 */
export async function startSorting(page: Page): Promise<void> {
  const start = page.getByRole("button", { name: copy("setup.start") });
  await start.focus();
  await start.click();
  await expect(page.getByRole("heading", { level: 1, name: copy("overview.title") })).toBeVisible();
}

import { expect, type Locator, test } from "@playwright/test";
import { launchApp } from "./app.ts";
import { COLOR_SCHEMES, skipUnlessBaselineOs } from "./baselines.ts";
import { copy } from "./copy.ts";
import { startSorting, walkToSetup } from "./onboarding.ts";

skipUnlessBaselineOs();

for (const colorScheme of COLOR_SCHEMES) {
  // Guards: an unintended change to a first-run screen (spacing, type, colour token) in this colour scheme.
  test(`onboarding screens, ${colorScheme}`, async () => {
    const { page, open, close, problems } = await launchApp({
      firstRun: true,
      colorScheme,
      exactSize: true,
    });
    try {
      const screens: readonly [name: string, route: string, ready: Locator][] = [
        [
          "welcome",
          "/welcome",
          page.getByRole("heading", { level: 1, name: copy("welcome.headline") }),
        ],
        [
          "connect",
          "/connect",
          page.getByRole("heading", { level: 1, name: copy("connect.title") }),
        ],
        ["setup", "/setup", page.getByRole("button", { name: copy("setup.start") })],
      ];
      for (const [name, route, ready] of screens) {
        await open(route);
        await expect(ready).toBeVisible();
        await expect.soft(page).toHaveScreenshot(`${name}-${colorScheme}.png`);
      }
      expect(problems).toEqual([]);
    } finally {
      await close();
    }
  });

  // Guards: an unintended change to a screen of the connected app in this colour scheme.
  test(`app screens after the first scan, ${colorScheme}`, async () => {
    const { page, open, close, problems } = await launchApp({
      firstRun: true,
      colorScheme,
      exactSize: true,
    });
    try {
      await open("/welcome");
      await walkToSetup(page);
      await startSorting(page);
      const sheet = page.getByRole("dialog", { name: copy("summary.title") });
      await expect(sheet).toBeVisible();
      await expect.soft(page).toHaveScreenshot(`summary-${colorScheme}.png`);
      await sheet.getByRole("button", { name: copy("action.close") }).click();
      await expect(sheet).toBeHidden();
      await expect.soft(page).toHaveScreenshot(`overview-${colorScheme}.png`);
      const screens: readonly [name: string, title: string][] = [
        ["notifications", copy("category.notifications")],
        ["documents", copy("documents.title")],
        ["activity", copy("activity.title")],
        ["settings", copy("settings.title")],
      ];
      for (const [name, title] of screens) {
        await page.getByRole("link", { name: title }).click();
        await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
        await expect.soft(page).toHaveScreenshot(`${name}-${colorScheme}.png`);
      }
      expect(problems).toEqual([]);
    } finally {
      await close();
    }
  });
}

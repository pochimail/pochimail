import { expect, test } from "@playwright/test";
import { launchApp } from "./app.ts";
import { COLOR_SCHEMES, skipUnlessBaselineOs } from "./baselines.ts";
import { copy } from "./copy.ts";

skipUnlessBaselineOs();

for (const colorScheme of COLOR_SCHEMES) {
  // Guards: an unintended change to a required state of the dev gallery in this colour scheme, a state added without a baseline, or a motion moment that throws.
  test(`every gallery state, ${colorScheme}`, async () => {
    const { page, open, close, problems } = await launchApp({ colorScheme, exactSize: true });
    try {
      await open("/gallery");
      await expect(
        page.getByRole("heading", { level: 1, name: copy("devGallery.title") }),
      ).toBeVisible();
      const ids = await page
        .locator("[data-gallery-entry]")
        .evaluateAll((items) => items.map((item) => item.getAttribute("data-gallery-entry") ?? ""));
      // Motion moments are driven by timers and replays, so they have no still picture to compare: they are only rendered
      // (a throw lands in `problems`). The required states are still and are compared.
      const states = ids.filter((id) => id.startsWith("state:"));
      expect(states.length).toBeGreaterThan(0);
      for (const id of states) {
        const entry = page.locator(`[data-gallery-entry="${id}"]`);
        await expect.soft(entry).toHaveScreenshot(`${id.replace(":", "-")}-${colorScheme}.png`);
      }
      expect(problems).toEqual([]);
    } finally {
      await close();
    }
  });
}

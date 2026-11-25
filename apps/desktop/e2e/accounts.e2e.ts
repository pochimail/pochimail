import { expect, test } from "@playwright/test";
import { launchApp } from "./app.ts";
import { copy } from "./copy.ts";
import { walkToSetup } from "./onboarding.ts";

// Guards: a Remove button that does not reach the worker, leaves the account listed, or removes the wrong one.
test("a user removes an account from Settings, and Welcome returns after the last one", async () => {
  const running = await launchApp({ firstRun: true });
  const { page } = running;
  try {
    await test.step("Connect the fixture accounts", () => walkToSetup(page));
    await running.open("/settings");
    const accounts = page.getByRole("region", { name: copy("settings.accounts") });
    const remove = accounts.getByRole("button", {
      name: new RegExp(`^${copy("accounts.remove")}: `),
    });
    await expect(remove).toHaveCount(2);
    const [removed, kept] = await remove.evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-label")?.split(": ")[1] ?? ""),
    );

    await test.step("Remove one: it asks first, then the account is gone and the other remains", async () => {
      await remove.first().click();
      const dialog = page.getByRole("dialog", {
        name: copy("accounts.remove.title", { address: removed ?? "" }),
      });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: copy("accounts.remove.confirm") }).click();
      await expect(accounts.getByText(removed ?? "")).toBeHidden();
      await expect(accounts.getByText(kept ?? "")).toBeVisible();
      await expect(remove).toHaveCount(1);
    });

    await test.step("Remove the last one: back to Welcome", async () => {
      await remove.first().click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: copy("accounts.remove.confirm") })
        .click();
      await expect(
        page.getByRole("heading", { level: 1, name: copy("welcome.headline") }),
      ).toBeVisible();
    });
    expect(running.problems).toEqual([]);
  } finally {
    await running.close();
  }
});

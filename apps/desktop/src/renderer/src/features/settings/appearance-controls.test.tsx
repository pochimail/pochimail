// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRpcClient } from "#shared/ipc/client.ts";
import { serveRpc } from "#shared/ipc/server.ts";
import { fromDomPort } from "#shared/ipc/transport.ts";
import { App } from "../../app/app.tsx";
import { createAppRouter } from "../../router.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Only the RPC boundary is faked: the real App, router, controller and I18nProvider render. */
function renderSettings() {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
  const { port1, port2 } = new MessageChannel();
  port1.start();
  port2.start();
  const updates: object[] = [];
  serveRpc(fromDomPort(port2), {
    procedures: {
      "settings.get": () => ({
        autonomy: "suggest" as const,
        capabilities: {
          "catch-what-matters": true,
          declutter: true,
          organize: true,
          "save-documents": true,
        },
        notifications: true,
        theme: "system" as const,
        locale: "en" as const,
      }),
      "settings.update": (patch) => {
        updates.push(patch);
        return undefined;
      },
    },
    subscriptions: { "app.events": () => undefined },
  });
  const client = createRpcClient(fromDomPort(port1));
  const router = createAppRouter(
    { getWorkerClient: () => Promise.resolve(client) },
    { initialEntries: ["/settings"] },
  );
  render(<App workerClient={client} router={router} />);
  return { updates };
}

/** The frame renders the same control twice (phone bar and sidebar footer); the Settings row is last. */
const settingsLanguageTrigger = () => {
  const triggers = screen.getAllByRole("button", { name: "Language" });
  return triggers[triggers.length - 1];
};

describe("Settings language control", () => {
  // Guards: a language segmented radio group instead of a dropdown showing the current locale.
  it("is a compact dropdown that names the current locale and marks it selected", async () => {
    renderSettings();
    await screen.findByRole("heading", { level: 1, name: "Settings" });

    const trigger = settingsLanguageTrigger();
    expect(trigger?.textContent).toContain("English");
    expect(screen.queryAllByRole("radio", { name: "Français" })).toHaveLength(0);

    await userEvent.click(trigger ?? document.body);
    const menu = await screen.findByRole("menu");
    const choices = screen.getAllByRole("menuitemradio");
    expect(choices.map((choice) => choice.textContent)).toEqual(["English", "Français", "日本語"]);
    expect(choices.map((choice) => choice.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
      "false",
    ]);
    expect(menu).toBeTruthy();
  });

  // Guards: a keyboard-opened menu that never reaches selectLocale or the screens below I18nProvider.
  it("selects a language with the keyboard, updating the label, the screen and settings", async () => {
    const { updates } = renderSettings();
    const heading = await screen.findByRole("heading", { level: 1, name: "Settings" });
    const trigger = settingsLanguageTrigger();

    trigger?.focus();
    await userEvent.keyboard("{ArrowDown}");
    await screen.findByRole("menu");
    await userEvent.keyboard("{ArrowDown}{Enter}");

    await waitFor(() => expect(heading.textContent).toBe("Réglages"));
    expect(trigger?.textContent).toContain("Français");
    expect(updates).toContainEqual({ locale: "fr" });
  });
});

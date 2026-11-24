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

function renderSettings(language: string) {
  vi.spyOn(navigator, "languages", "get").mockReturnValue([language]);
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

describe("Settings notifications section", () => {
  // Guards: Pochimail's notification preference having no UI, so the stored boolean can never be changed.
  it("shows the stored preference and saves a change", async () => {
    const { updates } = renderSettings("en-US");
    await screen.findByRole("heading", { level: 2, name: "Notifications" });

    const toggle = screen.getByRole("switch", { name: "Pochimail notifications" });
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));
    await userEvent.click(toggle);

    await waitFor(() => expect(updates).toEqual([{ notifications: false }]));
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  // Guards: a section title left in English, or reused from the mail category label, in another locale.
  it.each([
    ["fr-FR", "Notifications de Pochimail"],
    ["ja-JP", "Pochimailの通知"],
  ])("is translated for %s", async (language, label) => {
    renderSettings(language);
    expect(await screen.findByRole("switch", { name: label })).toBeTruthy();
  });
});

// @vitest-environment jsdom
// Guards: "My promises" rendered as a plain list with no Pochi callout, an undersized mascot, or a trailing separator — the copy must sit inside a tailed bubble with an enlarged Pochi and only inter-item dividers.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createRpcClient } from "#shared/ipc/client.ts";
import { serveRpc } from "#shared/ipc/server.ts";
import { fromDomPort } from "#shared/ipc/transport.ts";
import { App } from "../../app/app.tsx";
import { createAppRouter } from "../../router.tsx";

afterEach(cleanup);

/** The public Connect screen, mounted through the renderer entry point with fake IPC. */
const renderConnect = () => {
  const { port1, port2 } = new MessageChannel();
  port1.start();
  port2.start();
  serveRpc(fromDomPort(port2), {
    procedures: {
      "app.state": () => ({ status: "ready" as const, hasConnectedAccount: false }),
      "device.name": () => "Mac" as const,
      "settings.get": () => ({
        autonomy: "suggest" as const,
        capabilities: {
          "catch-what-matters": true,
          declutter: true,
          organize: true,
          "save-documents": true,
        },
        notifications: true,
        theme: "light" as const,
        locale: null,
      }),
    },
    subscriptions: { "app.events": () => undefined, "scan.progress": () => undefined },
  });
  const client = createRpcClient(fromDomPort(port1));
  const router = createAppRouter(
    { getWorkerClient: () => Promise.resolve(client) },
    { initialEntries: ["/connect"] },
  );
  render(<App workerClient={client} router={router} />);
};

describe("Connect promises", () => {
  it("puts 'My promises' in Pochi's tailed bubble, not a plain list", async () => {
    renderConnect();
    const heading = await screen.findByRole("heading", { name: "My promises" });
    const bubble = document.querySelector('[data-slot="speech-bubble-body"]');
    expect(bubble).not.toBeNull();
    expect(bubble?.contains(heading)).toBe(true);
    expect(bubble?.textContent).toContain("Nothing is deleted without your OK");

    const tail = bubble?.querySelector('[data-slot="speech-bubble-tail"]');
    expect(tail?.getAttribute("aria-hidden")).toBe("true");
    expect(tail?.className).toContain("rotate-45");
    expect(tail?.className).toContain("bg-card");

    const mascot = document.querySelector('[data-slot="mascot"]');
    expect(mascot?.className).toContain("w-20");
    expect(mascot?.className).not.toContain("w-10");
    expect(bubble?.parentElement?.contains(mascot)).toBe(true);

    const list = bubble?.querySelector("ul");
    expect(list?.className.split(" ")).not.toContain("border-b");
    expect(list?.querySelector("li")?.className.split(" ")).toContain("border-t");
  });
});

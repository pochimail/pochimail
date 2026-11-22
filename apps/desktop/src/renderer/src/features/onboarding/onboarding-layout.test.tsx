// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { createRpcClient } from "#shared/ipc/client.ts";
import { serveRpc } from "#shared/ipc/server.ts";
import { fromDomPort } from "#shared/ipc/transport.ts";
import { DEFAULT_APP_SETTINGS } from "#shared/settings.ts";
import { App } from "../../app/app.tsx";
import { createAppRouter } from "../../router.tsx";

afterEach(cleanup);

it("keeps appearance controls in flow with the step indicator, stacking below it when narrow (guards #180: an absolute control overlaying the header)", async () => {
  const { port1, port2 } = new MessageChannel();
  port1.start();
  port2.start();
  serveRpc(fromDomPort(port2), {
    procedures: {
      "device.name": () => "device" as const,
      "settings.get": () => DEFAULT_APP_SETTINGS,
    },
    subscriptions: { "app.events": () => undefined },
  });
  const client = createRpcClient(fromDomPort(port1));
  const router = createAppRouter(
    { getWorkerClient: () => Promise.resolve(client) },
    { initialEntries: ["/welcome"] },
  );
  render(<App workerClient={client} router={router} />);
  await screen.findByRole("list", { name: "Step 1 of 3" });

  const controls = document.querySelector('[data-slot="onboarding-controls"]');
  const header = controls?.closest("header");
  expect(controls).not.toBeNull();
  expect(header?.className).toContain("grid-cols-[");
  expect(header?.className).toContain("@max-narrow:flex-col");
  expect(controls?.className).toContain("min-w-0");
  expect(controls?.className).toContain("@max-narrow:justify-self-center");
  expect(document.querySelector('[data-slot="appearance-controls"]')?.className).toContain(
    "flex-wrap",
  );
  // No positioned ancestor may take the controls out of the header's grid/flex flow.
  for (
    let node: Element | null = controls ?? null;
    node !== header?.parentElement;
    node = node?.parentElement ?? null
  ) {
    if (node === null) break;
    expect(node.className, node.tagName).not.toMatch(/\babsolute\b/);
  }
});

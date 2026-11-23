// @vitest-environment jsdom
// Guards: screen titles that drift from the one token hierarchy, sit at a different top inset, or show a
// raw category id instead of the translated label used by the sidebar.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createRpcClient } from "#shared/ipc/client.ts";
import { serveRpc } from "#shared/ipc/server.ts";
import { fromDomPort } from "#shared/ipc/transport.ts";
import { App } from "../../app/app.tsx";
import { createAppRouter } from "../../router.tsx";

afterEach(cleanup);

const open = async (path: string) => {
  const { port1, port2 } = new MessageChannel();
  port1.start();
  port2.start();
  serveRpc(fromDomPort(port2), {
    procedures: {
      "app.state": () => ({ status: "ready" as const, hasConnectedAccount: true }),
      "device.name": () => "device" as const,
      "accounts.list": () => [
        { id: "a1", provider: "google" as const, displayName: "a@example.test" },
      ],
      "mailbox.categories": () => ({
        people: 0,
        records: 0,
        "purchases-travel": 0,
        "sign-ins-security": 0,
        notifications: 0,
        newsletters: 0,
        promotions: 0,
      }),
      "scan.status": () => [],
      "overview.get": () => ({
        scanned: 40,
        toReview: 0,
        waiting: 0,
        deadlines: 0,
        important: 0,
        oldestWaitingDays: 0,
        cleanable: [],
        figures: {
          archived: 0,
          savedCount: 0,
          savedSize: 0,
          deletableSize: 0,
          unsubscribed: 0,
          totalSize: 0,
        },
      }),
      "digest.get": () => ({ ready: false, itemCount: 0 }),
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
    },
    subscriptions: { "app.events": () => undefined, "scan.progress": () => undefined },
  });
  const client = createRpcClient(fromDomPort(port1));
  const router = createAppRouter(
    { getWorkerClient: () => Promise.resolve(client) },
    { initialEntries: [path] },
  );
  render(<App workerClient={client} router={router} />);
};

const PAGES = [
  ["/overview", "Overview"],
  ["/activity", "Activity"],
  ["/documents", "Documents"],
  ["/settings", "Settings"],
  ["/category/notifications", "Notifications"],
] as const;

describe("screen titles", () => {
  it.each(PAGES)("puts one token h1 at the same inset on %s", async (path, title) => {
    await open(path);
    const heading = await screen.findByRole("heading", { level: 1, name: title });
    const main = heading.closest("main");
    expect(main).not.toBeNull();
    expect(main?.firstElementChild).toBe(heading.parentElement);
    expect(main?.className).toContain("px-8");
    expect(main?.className).toContain("pt-8");
    expect(main?.className).toContain("w-full");
    expect(main?.className).not.toContain("max-w-");
    expect(main?.className).not.toContain("mx-auto");
    expect(heading.tagName).toBe("H1");
    expect(heading.className).toContain("text-title");
    expect(heading.className).toContain("leading-heading");
    expect(heading.className).not.toContain("text-4xl");
  });

  it.each([
    ["/category/sign-ins-security", "Sign-ins & security"],
    ["/category/purchases-travel", "Purchases & travel"],
  ])("titles %s with the translated sidebar label", async (path, title) => {
    await open(path);
    expect(await screen.findByRole("heading", { level: 1, name: title })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1, name: /sign ins security/iu })).toBeNull();
  });

  it.each([
    ["/overview", "Catch what matters"],
    ["/settings", "Appearance"],
  ])("uses the token section title on %s", async (path, section) => {
    await open(path);
    const heading = await screen.findByRole("heading", { level: 2, name: section });
    expect(heading.className).toContain("text-section");
    expect(heading.className).toContain("font-semibold");
  });
});

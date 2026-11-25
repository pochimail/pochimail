// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRpcClient } from "#shared/ipc/client.ts";
import type { EventOf } from "#shared/ipc/contract.ts";
import { serveRpc } from "#shared/ipc/server.ts";
import { fromDomPort } from "#shared/ipc/transport.ts";
import { App } from "../../app/app.tsx";
import { createAppRouter } from "../../router.tsx";

afterEach(cleanup);

const ACCOUNTS = [
  { id: "a1", provider: "google" as const, displayName: "ann@example.test" },
  { id: "a2", provider: "google" as const, displayName: "bob@example.test" },
];
const noCounts = {
  people: 0,
  records: 0,
  "purchases-travel": 0,
  "sign-ins-security": 0,
  notifications: 0,
  newsletters: 0,
  promotions: 0,
};

const setup = (
  path: string,
  accounts = ACCOUNTS,
  lost: { accountId: string; provider: string }[] = [],
) => {
  const { port1, port2 } = new MessageChannel();
  port1.start();
  port2.start();
  const reconnect = vi.fn(async (_input: { accountId: string }) => ({
    status: "reconnected" as const,
  }));
  let emit: ((event: EventOf<"app.events">) => void) | undefined;
  serveRpc(fromDomPort(port2), {
    procedures: {
      "app.state": () => ({
        status: "ready" as const,
        hasConnectedAccount: true,
        needsReauth: lost,
      }),
      "device.name": () => "device" as const,
      "accounts.list": () => accounts,
      "accounts.reconnect": reconnect,
      "mailbox.categories": () => noCounts,
      "overview.get": () => ({
        scanned: 0,
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
      "scan.status": () => [],
      "digest.get": () => ({ ready: false, itemCount: 0, archived: 0, saved: 0, unsubscribed: 0 }),
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
    subscriptions: {
      "app.events": (_input, send) => {
        emit = send;
        return undefined;
      },
      "scan.progress": () => undefined,
    },
  });
  const client = createRpcClient(fromDomPort(port1));
  const router = createAppRouter(
    { getWorkerClient: () => Promise.resolve(client) },
    { initialEntries: [path] },
  );
  render(<App workerClient={client} router={router} />);
  return {
    reconnect,
    emit: async (event: EventOf<"app.events">) => {
      await vi.waitFor(() => expect(emit).toBeDefined());
      emit?.(event);
    },
  };
};

const lostAccess = /I lost access to your Gmail account/;

describe("the reconnect gate", () => {
  it("replaces a screen whose only account lost access, reconnects from it and returns when reconnected (guards an app that silently shows a dead account)", async () => {
    const app = setup("/overview", ACCOUNTS.slice(0, 1));
    await screen.findByRole("heading", { level: 1, name: "Overview" });
    await app.emit({ type: "NeedsReauth", accountId: "a1", provider: "Gmail" });

    await userEvent.click(await screen.findByRole("button", { name: "Reconnect" }));
    await waitFor(() => expect(app.reconnect).toHaveBeenCalledWith({ accountId: "a1" }));
    expect(screen.getByText(lostAccess)).toBeTruthy();

    await app.emit({ type: "Reconnected", accountId: "a1" });
    await screen.findByRole("heading", { level: 1, name: "Overview" });
    await waitFor(() => expect(screen.queryByText(lostAccess)).toBeNull());
  });

  it("keeps the screen while another account in the selection still syncs, and gates the lost one alone (guards one dead account blocking the rest)", async () => {
    const app = setup("/overview");
    await screen.findByRole("heading", { level: 1, name: "Overview" });
    await app.emit({ type: "NeedsReauth", accountId: "a1", provider: "Gmail" });

    await userEvent.click(await screen.findByRole("button", { name: /Account: All accounts/ }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "ann@example.test" }));
    expect(await screen.findByText(lostAccess)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /Account: ann@example.test/ }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "bob@example.test" }));
    await screen.findByRole("heading", { level: 1, name: "Overview" });
  });

  it("shows the gate after a reload from what the worker already knows, with no event (guards a reloaded screen that hides the Reconnect gate)", async () => {
    setup("/overview", ACCOUNTS.slice(0, 1), [{ accountId: "a1", provider: "Gmail" }]);

    expect(await screen.findByText(lostAccess)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeTruthy();
  });
});

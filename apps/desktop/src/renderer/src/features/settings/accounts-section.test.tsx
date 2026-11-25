// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRpcClient } from "#shared/ipc/client.ts";
import type { EventOf, OutputOf } from "#shared/ipc/contract.ts";
import { serveRpc } from "#shared/ipc/server.ts";
import { fromDomPort } from "#shared/ipc/transport.ts";
import { App } from "../../app/app.tsx";
import { createAppRouter } from "../../router.tsx";

afterEach(cleanup);

type Account = OutputOf<"accounts.list">[number];
const ANN: Account = { id: "a1", provider: "google", displayName: "ann@example.test" };
const BOB: Account = { id: "a2", provider: "microsoft", displayName: "bob@example.test" };
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
  accounts: Account[],
  removal: OutputOf<"accounts.remove"> = { status: "removed", remoteRevoked: true },
) => {
  const { port1, port2 } = new MessageChannel();
  port1.start();
  port2.start();
  const remove = vi.fn(async ({ accountId }: { accountId: string }) => {
    if (removal.status === "removed")
      accounts.splice(0, accounts.length, ...accounts.filter((a) => a.id !== accountId));
    return removal;
  });
  let emit: ((event: EventOf<"app.events">) => void) | undefined;
  serveRpc(fromDomPort(port2), {
    procedures: {
      "app.state": () => ({
        status: "ready" as const,
        hasConnectedAccount: accounts.length > 0,
        needsReauth: [],
      }),
      "device.name": () => "device" as const,
      "accounts.list": () => [...accounts],
      "accounts.remove": remove,
      "accounts.reconnect": async () => ({ status: "reconnected" as const }),
      "mailbox.categories": () => noCounts,
      "scan.status": () => [],
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
    { initialEntries: ["/settings"] },
  );
  render(<App workerClient={client} router={router} />);
  return {
    remove,
    emit: async (event: EventOf<"app.events">) => {
      await vi.waitFor(() => expect(emit).toBeDefined());
      emit?.(event);
    },
  };
};

const accountsSection = async () => within(await screen.findByRole("region", { name: "Accounts" }));
const confirmRemoval = async (address: string) => {
  const section = await accountsSection();
  await userEvent.click(section.getByRole("button", { name: `Remove: ${address}` }));
  return within(await screen.findByRole("dialog", { name: `Remove ${address}?` }));
};

describe("Settings › Accounts", () => {
  it("lists one row per account and removes only the chosen one after saying what happens (guards a removal without consent or of the wrong account)", async () => {
    const app = setup([ANN, BOB]);
    const dialog = await confirmRemoval("ann@example.test");
    expect(dialog.getByText(/revoke my access at Gmail/)).toBeTruthy();
    expect(dialog.getByText(/delete what Pochimail keeps/)).toBeTruthy();
    expect(dialog.getByText(/mailbox and your saved documents aren’t touched/)).toBeTruthy();
    expect(app.remove).not.toHaveBeenCalled();

    await userEvent.click(dialog.getByRole("button", { name: "Remove account" }));

    await waitFor(() => expect(app.remove).toHaveBeenCalledWith({ accountId: "a1" }));
    const section = await accountsSection();
    await waitFor(() => expect(section.queryByText("ann@example.test")).toBeNull());
    expect(section.getByText("bob@example.test")).toBeTruthy();
    expect(await screen.findByText("I removed ann@example.test.")).toBeTruthy();
  });

  it("says the provider may still list Pochimail when it could not be told (guards a false 'revoked')", async () => {
    setup([ANN, BOB], { status: "removed", remoteRevoked: false });
    const dialog = await confirmRemoval("bob@example.test");

    await userEvent.click(dialog.getByRole("button", { name: "Remove account" }));

    expect(await screen.findByText(/Outlook may still list Pochimail/)).toBeTruthy();
  });

  it("a failed removal keeps the account and the dialog and says nothing changed (guards a row that vanishes while the data stays)", async () => {
    const app = setup([ANN, BOB], { status: "failed", reason: "storage-unavailable" });
    const section = await accountsSection();
    const dialog = await confirmRemoval("ann@example.test");

    await userEvent.click(dialog.getByRole("button", { name: "Remove account" }));

    expect(await dialog.findByText(/Nothing was changed/)).toBeTruthy();
    expect(app.remove).toHaveBeenCalledTimes(1);
    expect(section.getByText("ann@example.test")).toBeTruthy();
  });

  it("removing the last account returns to Welcome (guards a settings screen with no account)", async () => {
    setup([ANN]);
    const dialog = await confirmRemoval("ann@example.test");

    await userEvent.click(dialog.getByRole("button", { name: "Remove account" }));

    expect(await screen.findByRole("heading", { level: 1 })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("region", { name: "Accounts" })).toBeNull());
  });

  it("offers Reconnect only for an account that lost access (guards a Reconnect that signs in for nothing)", async () => {
    const app = setup([ANN, BOB]);
    const section = await accountsSection();
    expect(section.queryByRole("button", { name: /Reconnect/ })).toBeNull();

    await app.emit({ type: "NeedsReauth", accountId: "a2", provider: "Outlook" });

    expect(
      await section.findByRole("button", { name: "Reconnect: bob@example.test" }),
    ).toBeTruthy();
    expect(section.getAllByRole("button", { name: /Reconnect/ })).toHaveLength(1);
    expect(section.getByText(/needs you to sign in again/)).toBeTruthy();
  });
});

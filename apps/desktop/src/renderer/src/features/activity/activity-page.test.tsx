// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { createRpcClient } from "#shared/ipc/client.ts";
import type { InputOf, OutputOf } from "#shared/ipc/contract.ts";
import { serveRpc } from "#shared/ipc/server.ts";
import { fromDomPort } from "#shared/ipc/transport.ts";
import { App } from "../../app/app.tsx";
import { createAppRouter } from "../../router.tsx";

afterEach(cleanup);

type Entry = OutputOf<"activity.list">["entries"][number];
const now = new Date().toISOString();
const entry = (over: Partial<Entry> & Pick<Entry, "actionId" | "kind">): Entry => ({
  messageCount: 3,
  accountId: "a1",
  outcome: "applied",
  at: now,
  undo: "available",
  ...over,
});

const setup = (entries: Entry[]) => {
  const { port1, port2 } = new MessageChannel();
  port1.start();
  port2.start();
  const undone: InputOf<"cleanup.undo">[] = [];
  serveRpc(fromDomPort(port2), {
    procedures: {
      "accounts.list": () => [{ id: "a1", provider: "google" as const, displayName: "Account" }],
      "mailbox.types": () => ({
        personal: 0,
        transactional: 0,
        notification: 0,
        newsletter: 0,
        promotion: 0,
      }),
      "scan.status": () => [],
      "activity.list": () => ({ entries, nextCursor: null }),
      "cleanup.undo": (input) => {
        undone.push(input);
        return { undone: 1, alreadyUndone: 0, irreversible: 0, notApplied: 0, failed: 0 };
      },
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
    { initialEntries: ["/activity"] },
  );
  render(<App workerClient={client} router={router} />);
  return undone;
};

describe("activity screen (#138)", () => {
  // Guards: an Undo that bypasses cleanup.undo, an unsubscribe with an Undo button, or a batch that cannot be undone as one.
  it("undoes one action or a whole batch through cleanup.undo and offers no undo for an unsubscribe", async () => {
    const undone = setup([
      entry({ actionId: "act-1", batchId: "b1", kind: "trash", messageCount: 212 }),
      entry({ actionId: "act-2", batchId: "b1", kind: "archive", messageCount: 5 }),
      entry({ actionId: "act-3", kind: "unsubscribe", messageCount: 5, undo: "irreversible" }),
      entry({ actionId: "act-4", kind: "archive", outcome: "undone", undo: "unavailable" }),
      entry({ actionId: "act-5", kind: "trash", undo: "unavailable" }),
    ]);
    expect(await screen.findByText("Moved 212 emails to the Trash")).toBeTruthy();
    expect(screen.getByText("Unsubscribed from 5 senders")).toBeTruthy();
    expect(screen.getByText("Can’t be undone")).toBeTruthy();
    expect(screen.getByText("Undone")).toBeTruthy();
    expect(screen.getByText("Undo unavailable")).toBeTruthy();
    // Two single undos (act-1, act-2) and one for the batch; none for the unsubscribe or the settled ones.
    expect(screen.getAllByRole("button", { name: "Undo" })).toHaveLength(2);

    await userEvent.click(screen.getByRole("button", { name: "Undo all" }));
    await waitFor(() => expect(undone).toEqual([{ batchId: "b1" }]));
    await userEvent.click(screen.getAllByRole("button", { name: "Undo" })[0] as HTMLElement);
    await waitFor(() => expect(undone.at(-1)).toEqual({ actionId: "act-1" }));
  });

  it("shows the empty state when nothing was done yet", async () => {
    // Guards: an empty log that renders a blank page.
    setup([]);
    expect(await screen.findByRole("status", { name: "Nothing yet" })).toBeTruthy();
  });
});

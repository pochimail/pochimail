// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRpcClient } from "#shared/ipc/client.ts";
import type { InputOf, OutputOf } from "#shared/ipc/contract.ts";
import { serveRpc } from "#shared/ipc/server.ts";
import type { SyncResultView } from "#shared/ipc/sync-contract.ts";
import { fromDomPort } from "#shared/ipc/transport.ts";
import { App } from "../../app/app.tsx";
import { createAppRouter } from "../../router.tsx";

afterEach(cleanup);

type Status = OutputOf<"sync.status">;
type Outcome = OutputOf<"sync.now">;

const accounts = [
  { id: "a1", provider: "google" as const, displayName: "ann@example.test" },
  { id: "a2", provider: "google" as const, displayName: "bob@example.test" },
];
const zeroCounts = {
  people: 0,
  records: 0,
  "purchases-travel": 0,
  "sign-ins-security": 0,
  notifications: 0,
  newsletters: 0,
  promotions: 0,
};

const setup = (options: { path?: string; status?: Status } = {}) => {
  const { port1, port2 } = new MessageChannel();
  port1.start();
  port2.start();
  const calls: InputOf<"sync.now">[] = [];
  const state = {
    status: options.status ?? ([] as Status),
    release: (_outcome: Outcome) => {},
    calls,
  };
  serveRpc(fromDomPort(port2), {
    procedures: {
      "app.state": () => ({ status: "ready" as const, hasConnectedAccount: true }),
      "device.name": () => "device" as const,
      "accounts.list": () => accounts,
      "mailbox.categories": () => zeroCounts,
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
      "sync.status": () => state.status,
      "sync.now": (input) => {
        calls.push(input);
        return new Promise<Outcome>((resolve) => {
          state.release = resolve;
        });
      },
    },
    subscriptions: { "app.events": () => undefined, "scan.progress": () => undefined },
  });
  const client = createRpcClient(fromDomPort(port1));
  const router = createAppRouter(
    { getWorkerClient: () => Promise.resolve(client) },
    { initialEntries: [options.path ?? "/overview"] },
  );
  render(<App workerClient={client} router={router} />);
  return state;
};

const button = (name: string) => screen.findByRole("button", { name });

const finish = async (state: ReturnType<typeof setup>, outcome: Outcome, last: Status) => {
  state.status = last;
  state.release(outcome);
};

describe("Sync now in the shell", () => {
  it("shows the running state, stays disabled during the run and is enabled again after it", async () => {
    // Guards: a Sync now that can be pressed twice, or that never comes back after the run.
    const state = setup();
    await userEvent.click(await button("Sync now"));
    const running = await button("Syncing…");
    expect((running as HTMLButtonElement).disabled).toBe(true);
    expect(running.getAttribute("aria-busy")).toBe("true");
    expect(state.calls).toEqual([{}]);

    await finish(state, { results: [] }, []);
    const again = await button("Sync now");
    await waitFor(() => expect((again as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("syncs only the selected account, and All accounts when none is selected", async () => {
    // Guards: a button that syncs every account while one is selected, or the reverse.
    const one = setup({ path: "/overview?account=a2" });
    await userEvent.click(await button("Sync now"));
    expect(one.calls).toEqual([{ accountId: "a2" }]);
  });

  it("a button that finds a sync already running after a reload is disabled", async () => {
    // Guards: a reload that lets a second sync start while one is running.
    setup({ status: [{ accountId: "a1", running: true, last: null }] });
    const running = await button("Syncing…");
    expect((running as HTMLButtonElement).disabled).toBe(true);
  });

  const resumeAt = Date.UTC(2999, 0, 1, 10, 30);
  const failures: {
    name: string;
    result: SyncResultView;
    shows: RegExp;
  }[] = [
    {
      name: "offline",
      result: { status: "offline" },
      shows: /You’re offline\. We’ll sync when you’re back\./,
    },
    {
      name: "a sign-in that expired",
      result: { status: "needs-reauth" },
      shows: /ann@example\.test needs you to sign in again\./,
    },
    {
      name: "a rate limit",
      result: { status: "rate-limited", resumeAt },
      shows: /ann@example\.test asked us to slow down\. We’ll sync again at /,
    },
    {
      name: "a failure",
      result: { status: "failed" },
      shows: /We couldn’t sync ann@example\.test\./,
    },
  ];
  for (const { name, result, shows } of failures) {
    it(`enables the button again after ${name} and says what to do`, async () => {
      // Guards: an error that is swallowed, leaves the button stuck, or names no next step.
      const state = setup();
      await userEvent.click(await button("Sync now"));
      await finish(state, { results: [{ accountId: "a1", result }] }, [
        { accountId: "a1", running: false, last: { result, at: 1 } },
      ]);
      const again = await button("Sync now");
      await waitFor(() => expect((again as HTMLButtonElement).disabled).toBe(false));
      const message = await screen.findByRole("status");
      expect(message.textContent).toMatch(shows);
      const reconnect = within(message).queryByRole("button", { name: "Reconnect" });
      expect(reconnect === null).toBe(result.status !== "needs-reauth");
    });
  }

  it("names the account that failed when All accounts is synced, and the other is not blamed", async () => {
    // Guards: a failure that does not say which account, or one that taints the others.
    const state = setup();
    await userEvent.click(await button("Sync now"));
    await finish(
      state,
      {
        results: [
          { accountId: "a1", result: { status: "completed", stored: 1, restarted: false } },
          { accountId: "a2", result: { status: "failed" } },
        ],
      },
      [
        {
          accountId: "a1",
          running: false,
          last: { result: { status: "completed", stored: 1, restarted: false }, at: 1 },
        },
        { accountId: "a2", running: false, last: { result: { status: "failed" }, at: 1 } },
      ],
    );
    const message = await screen.findByRole("status");
    expect(message.textContent).toContain("bob@example.test");
    expect(message.textContent).not.toContain("ann@example.test");
  });

  it("a Reconnect on an expired sign-in opens Connect", async () => {
    // Guards: an expired sign-in that offers no way back.
    const state = setup();
    await userEvent.click(await button("Sync now"));
    await finish(state, { results: [{ accountId: "a1", result: { status: "needs-reauth" } }] }, [
      { accountId: "a1", running: false, last: { result: { status: "needs-reauth" }, at: 1 } },
    ]);
    await userEvent.click(await screen.findByRole("button", { name: "Reconnect" }));
    await vi.waitFor(() => expect(screen.queryByRole("button", { name: "Reconnect" })).toBeNull());
  });
});

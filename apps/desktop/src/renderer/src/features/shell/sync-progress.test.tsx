// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { createRpcClient } from "#shared/ipc/client.ts";
import type { EventOf, OutputOf } from "#shared/ipc/contract.ts";
import { serveRpc } from "#shared/ipc/server.ts";
import { fromDomPort } from "#shared/ipc/transport.ts";
import { App } from "../../app/app.tsx";
import { createAppRouter } from "../../router.tsx";

afterEach(cleanup);

type Job = OutputOf<"scan.status">[number];
const activeJob: Job = { accountId: "a1", jobId: "j1", status: "running", processed: 0 };
const zero = {
  people: 0,
  records: 0,
  "purchases-travel": 0,
  "sign-ins-security": 0,
  notifications: 0,
  newsletters: 0,
  promotions: 0,
};
const indicator = () => screen.queryByRole("progressbar", { name: "Syncing your email" });

const setup = (jobs: Job[] = [activeJob], path = "/overview") => {
  const { port1, port2 } = new MessageChannel();
  port1.start();
  port2.start();
  const state = {
    jobs: [...jobs],
    stopped: 0,
    emitters: new Map<string, ((event: EventOf<"scan.progress">) => void)[]>(),
    appEvents: (_event: EventOf<"app.events">) => {},
    progress: async (event: EventOf<"scan.progress">) => {
      await waitFor(() => expect(state.emitters.get(event.accountId)?.length).toBeGreaterThan(0));
      for (const emit of state.emitters.get(event.accountId) ?? []) emit(event);
    },
  };
  serveRpc(fromDomPort(port2), {
    procedures: {
      "app.state": () => ({ status: "ready" as const, hasConnectedAccount: true }),
      "device.name": () => "device" as const,
      "accounts.list": () => [
        { id: "a1", provider: "google" as const, displayName: "a@example.test" },
      ],
      "mailbox.categories": () => zero,
      "scan.status": ({ accountIds }) =>
        state.jobs.filter((job) => accountIds.includes(job.accountId)),
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
    subscriptions: {
      "scan.progress": ({ accountId }, emit) => {
        state.emitters.set(accountId, [...(state.emitters.get(accountId) ?? []), emit]);
        return () => {
          state.stopped++;
        };
      },
      "app.events": (_input, emit) => {
        state.appEvents = emit;
        return undefined;
      },
    },
  });
  const client = createRpcClient(fromDomPort(port1));
  const router = createAppRouter(
    { getWorkerClient: () => Promise.resolve(client) },
    { initialEntries: [path] },
  );
  render(<App workerClient={client} router={router} />);
  return state;
};

describe("sync progress", () => {
  it("stays visible across navigation and clears when the scan completes (guards a per-page or stuck bar)", async () => {
    // Guards: a progress bar scoped to one page, or one that stays after the scan completes.
    const user = userEvent.setup();
    const state = setup();
    const bar = await screen.findByRole("progressbar", { name: "Syncing your email" });
    const nav = await screen.findByRole("navigation", { name: "Main navigation" });

    await user.click(within(nav).getByRole("link", { name: "Settings" }));
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Syncing your email" })).toBe(bar);

    await state.progress({ accountId: "a1", phase: "classifying", processed: 25, total: 100 });
    await waitFor(() =>
      expect(
        screen
          .getByRole("progressbar", { name: "Syncing your email" })
          .getAttribute("aria-valuenow"),
      ).toBe("25"),
    );

    state.jobs = [];
    await state.progress({ accountId: "a1", phase: "done", processed: 100, total: 100 });
    await waitFor(() => expect(indicator()).toBeNull());
  });

  it("clears on failure and cancellation reported by the worker (guards a bar left over after the scan stopped)", async () => {
    // Guards: a bar left on screen when the worker reports failure or cancellation.
    const state = setup([activeJob], "/settings");
    expect(await screen.findByRole("progressbar", { name: "Syncing your email" })).toBeTruthy();

    state.jobs = [];
    state.appEvents({ type: "ScanFailed", accountId: "a1", reason: "offline" });
    await waitFor(() => expect(indicator()).toBeNull());

    state.jobs = [activeJob];
    await state.progress({ accountId: "a1", phase: "classifying", processed: 5, total: 100 });
    expect(await screen.findByRole("progressbar", { name: "Syncing your email" })).toBeTruthy();

    state.jobs = [];
    state.appEvents({ type: "ScanCancelled", accountId: "a1", jobId: "j1" });
    await waitFor(() => expect(indicator()).toBeNull());
  });

  it("shows nothing without a live scan and unsubscribes on unmount (guards a fake timer or leaked listener)", async () => {
    // Guards: a fake timer showing progress with no scan, or a listener surviving unmount.
    setup([]);
    expect(await screen.findByRole("navigation", { name: "Main navigation" })).toBeTruthy();
    expect(indicator()).toBeNull();
    cleanup();

    const state = setup();
    expect(await screen.findByRole("progressbar", { name: "Syncing your email" })).toBeTruthy();
    await waitFor(() => expect(state.emitters.get("a1")?.length).toBeGreaterThan(0));
    cleanup();
    await waitFor(() => expect(state.stopped).toBeGreaterThan(0));
    expect(indicator()).toBeNull();
  });
});

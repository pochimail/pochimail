import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRpcClient } from "#shared/ipc/client.ts";
import type { EventOf } from "#shared/ipc/contract.ts";
import { serveRpc } from "#shared/ipc/server.ts";
import { fromDomPort } from "#shared/ipc/transport.ts";
import { createOptimisticActionRegistry } from "./optimistic.ts";
import { subscribeAppEvents } from "./worker-events.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const createFakeIpc = () => {
  const { port1, port2 } = new MessageChannel();
  port1.start();
  port2.start();
  return {
    client: createRpcClient(fromDomPort(port1)),
    server: fromDomPort(port2),
    close: () => {
      port1.close();
      port2.close();
    },
  };
};

describe("query-from-events", () => {
  it("updates a cached query from an app event without a refetch", async () => {
    let emitEvent: ((event: EventOf<"app.events">) => void) | undefined;
    const { client, server, close } = createFakeIpc();
    serveRpc(server, {
      procedures: {},
      subscriptions: {
        "app.events": (_input, push) => {
          emitEvent = push;
          return undefined;
        },
      },
    });

    const queryClient = new QueryClient();
    const fetcher = vi.fn(async () => "initial");
    await queryClient.fetchQuery({ queryKey: ["settings"], queryFn: fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);

    const unsubscribe = client.subscribe("app.events", undefined, (event) => {
      if (event.type === "ActionApplied") queryClient.setQueryData(["settings"], event.actionId);
    });

    await vi.waitFor(() => expect(emitEvent).toBeTypeOf("function"));
    emitEvent?.({ type: "ActionApplied", actionId: "applied-1" });

    await vi.waitFor(() => expect(queryClient.getQueryData(["settings"])).toBe("applied-1"));
    expect(fetcher).toHaveBeenCalledTimes(1);

    unsubscribe();
    close();
  });

  it("rolls back a failed optimistic mutation when ActionFailed arrives", async () => {
    let emitEvent: ((event: EventOf<"app.events">) => void) | undefined;
    const { client, server, close } = createFakeIpc();
    serveRpc(server, {
      procedures: {},
      subscriptions: {
        "app.events": (_input, push) => {
          emitEvent = push;
          return undefined;
        },
      },
    });

    const queryClient = new QueryClient();
    const registry = createOptimisticActionRegistry();
    const unsubscribe = subscribeAppEvents(client, registry);

    queryClient.setQueryData(["settings"], { autopilot: false, notifications: true });
    registry.start({
      actionId: "a1",
      queryKey: ["settings"],
      queryClient,
      optimistic: () => ({ autopilot: true, notifications: true }),
    });
    expect(queryClient.getQueryData(["settings"])).toEqual({
      autopilot: true,
      notifications: true,
    });

    await vi.waitFor(() => expect(emitEvent).toBeTypeOf("function"));
    emitEvent?.({ type: "ActionFailed", actionId: "a1", reason: "unknown" });

    await vi.waitFor(() =>
      expect(queryClient.getQueryData(["settings"])).toEqual({
        autopilot: false,
        notifications: true,
      }),
    );

    unsubscribe();
    close();
  });

  it("logs subscription error codes, settles pending optimistic actions as failed, and resubscribes with backoff", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let subscribeCount = 0;
    const { client, server, close } = createFakeIpc();
    serveRpc(server, {
      procedures: {},
      subscriptions: {
        "app.events": () => {
          subscribeCount += 1;
          if (subscribeCount === 1) throw new Error("boom");
          return undefined;
        },
      },
    });

    const queryClient = new QueryClient();
    const registry = createOptimisticActionRegistry();
    const unsubscribe = subscribeAppEvents(client, registry);

    registry.start({
      actionId: "a1",
      queryKey: ["settings"],
      queryClient,
      optimistic: () => ({ autopilot: true }),
    });
    expect(queryClient.getQueryData(["settings"])).toEqual({ autopilot: true });

    await vi.waitFor(() => expect(subscribeCount).toBe(1));
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledWith("[app.events]", "HANDLER_FAILED"));
    expect(queryClient.getQueryData(["settings"])).toBeUndefined();

    await vi.waitFor(() => expect(subscribeCount).toBe(2), { timeout: 1500 });

    unsubscribe();
    close();
  });

  it("tells the person when a scan fails and ignores it for optimistic actions (guards a silent failed scan or a rollback of unrelated actions)", async () => {
    let emitEvent: ((event: EventOf<"app.events">) => void) | undefined;
    const { client, server, close } = createFakeIpc();
    serveRpc(server, {
      procedures: {},
      subscriptions: {
        "app.events": (_input, push) => {
          emitEvent = push;
          return undefined;
        },
      },
    });
    const registry = createOptimisticActionRegistry();
    const fail = vi.spyOn(registry, "fail");
    const onScanFailed = vi.fn();
    const unsubscribe = subscribeAppEvents(client, registry, onScanFailed);

    await vi.waitFor(() => expect(emitEvent).toBeTypeOf("function"));
    emitEvent?.({ type: "ScanFailed", accountId: "acc-1", reason: "offline" });

    await vi.waitFor(() => expect(onScanFailed).toHaveBeenCalledTimes(1));
    expect(fail).not.toHaveBeenCalled();
    unsubscribe();
    close();
  });

  it("re-reads scan status when a scan fails or is cancelled (guards a progress indicator stuck after the scan stopped)", async () => {
    // Guards: failure and cancellation leaving the shell's scan state stale.
    let emitEvent: ((event: EventOf<"app.events">) => void) | undefined;
    const { client, server, close } = createFakeIpc();
    serveRpc(server, {
      procedures: {},
      subscriptions: {
        "app.events": (_input, push) => {
          emitEvent = push;
          return undefined;
        },
      },
    });
    const onScanEnded = vi.fn();
    const unsubscribe = subscribeAppEvents(
      client,
      createOptimisticActionRegistry(),
      undefined,
      undefined,
      onScanEnded,
    );

    await vi.waitFor(() => expect(emitEvent).toBeTypeOf("function"));
    emitEvent?.({ type: "ScanFailed", accountId: "acc-1", reason: "offline" });
    emitEvent?.({ type: "ScanCancelled", accountId: "acc-1", jobId: "job-1" });

    await vi.waitFor(() => expect(onScanEnded).toHaveBeenCalledTimes(2));
    unsubscribe();
    close();
  });

  it("re-reads the lists when an action is applied, undone or fails (guards an Activity list that stays stale after Undo)", async () => {
    // Guards: ActionUndone or ActionFailed not refreshing what the screens show.
    let emitEvent: ((event: EventOf<"app.events">) => void) | undefined;
    const { client, server, close } = createFakeIpc();
    serveRpc(server, {
      procedures: {},
      subscriptions: {
        "app.events": (_input, push) => {
          emitEvent = push;
          return undefined;
        },
      },
    });
    const onMailboxChanged = vi.fn();
    const unsubscribe = subscribeAppEvents(
      client,
      createOptimisticActionRegistry(),
      undefined,
      onMailboxChanged,
    );

    await vi.waitFor(() => expect(emitEvent).toBeTypeOf("function"));
    emitEvent?.({ type: "ActionApplied", actionId: "a1" });
    emitEvent?.({ type: "ActionUndone", actionId: "a1" });
    emitEvent?.({ type: "ActionFailed", actionId: "a2", reason: "provider-error" });

    await vi.waitFor(() => expect(onMailboxChanged).toHaveBeenCalledTimes(3));
    unsubscribe();
    close();
  });
});

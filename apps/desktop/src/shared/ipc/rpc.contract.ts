import { describe, expect, it, vi } from "vitest";
import { createRpcClient } from "./client.ts";
import type { RpcError } from "./protocol.ts";
import { type Handlers, serveRpc } from "./server.ts";
import type { Transport } from "./transport.ts";

export type Link = { client: Transport; server: Transport; close: () => void };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Delays everything the renderer receives, like a UI thread that is busy rendering. */
const slowConsumer = (transport: Transport, delayMs: number): Transport => {
  let queue: Promise<void> = Promise.resolve();
  return {
    ...transport,
    onMessage: (handler) =>
      transport.onMessage((data) => {
        queue = queue.then(async () => {
          await sleep(delayMs);
          handler(data);
        });
      }),
  };
};

const rejection = async (promise: Promise<unknown>): Promise<RpcError | undefined> =>
  promise.then(
    () => undefined,
    (error: RpcError) => error,
  );

/**
 * Behaviour suite for the RPC + subscription layer over any `Transport` pair (DOM MessageChannel today; M2 adapters and
 * the real worker link reuse it unchanged by passing their own `connect`).
 */
export const describeRpcContract = (name: string, connect: () => Link): void => {
  describe(`rpc contract: ${name}`, () => {
    const setup = (handlers: Handlers, options: { slowMs?: number; timeoutMs?: number } = {}) => {
      const link = connect();
      serveRpc(link.server, handlers);
      const client = createRpcClient(
        options.slowMs === undefined ? link.client : slowConsumer(link.client, options.slowMs),
        options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs },
      );
      return { link, client };
    };

    // Guards: batching + ack backpressure dropping or reordering events when the renderer is slower than the worker.
    it("delivers every event exactly once and in order to a slow consumer", async () => {
      let emit: (event: { type: "ActionApplied"; actionId: string }) => void = () => {};
      const { link, client } = setup(
        {
          procedures: {},
          subscriptions: {
            "app.events": (_input, push) => {
              emit = push;
              return undefined;
            },
          },
        },
        { slowMs: 60 },
      );
      const seen: string[] = [];
      client.subscribe("app.events", undefined, (event) => {
        if (event.type === "ActionApplied") seen.push(event.actionId);
      });
      await vi.waitFor(() => expect(emit).not.toBe(undefined));
      await sleep(20);
      const total = 1000;
      for (let i = 0; i < total; i++) {
        emit({ type: "ActionApplied", actionId: String(i) });
        if (i % 50 === 0) await sleep(10);
      }
      await vi.waitFor(() => expect(seen).toHaveLength(total), { timeout: 15_000 });
      expect(seen).toEqual(Array.from({ length: total }, (_, i) => String(i)));
      link.close();
    }, 20_000);

    // Guards: a progress burst flooding the renderer with stale states instead of keeping the latest per account.
    it("coalesces progress per key and keeps the newest value", async () => {
      let emit: (event: {
        accountId: string;
        phase: "fetching";
        processed: number;
        total: number;
      }) => void = () => {};
      const { link, client } = setup({
        procedures: {},
        subscriptions: {
          "scan.progress": (_input, push) => {
            emit = push;
            return undefined;
          },
        },
      });
      const seen: { accountId: string; processed: number }[] = [];
      client.subscribe("scan.progress", { accountId: "a" }, (event) => seen.push(event));
      await vi.waitFor(() => expect(emit).not.toBe(undefined));
      await sleep(20);
      for (let i = 0; i < 200; i++)
        emit({ accountId: i % 2 === 0 ? "a" : "b", phase: "fetching", processed: i, total: 200 });
      await vi.waitFor(() => expect(seen).toHaveLength(2));
      await sleep(120);
      expect(seen).toEqual([
        { accountId: "a", phase: "fetching", processed: 198, total: 200 },
        { accountId: "b", phase: "fetching", processed: 199, total: 200 },
      ]);
      link.close();
    });

    // Guards: bad input reaching a handler, from either a buggy screen or a compromised renderer.
    it("rejects invalid input with BAD_INPUT on both sides and never runs the handler", async () => {
      const startScan = vi.fn(() => ({ jobId: "j" }));
      const { link, client } = setup({
        procedures: { "scan.start": startScan },
        subscriptions: {},
      });
      const clientSide = await rejection(client.call("scan.start", { accountId: 42 } as never));
      expect(clientSide?.code).toBe("BAD_INPUT");
      // A hostile renderer skips the client: the worker must still answer with a typed error.
      const replies: unknown[] = [];
      link.client.onMessage((data) => replies.push(data));
      link.client.post({ kind: "call", id: 99, procedure: "scan.start", input: { accountId: "" } });
      await vi.waitFor(() => expect(replies).toHaveLength(1));
      expect(replies[0]).toMatchObject({
        kind: "failure",
        id: 99,
        error: { code: "BAD_INPUT" },
      });
      expect(startScan).not.toHaveBeenCalled();
      link.close();
    });

    // Guards: a handler returning the wrong shape (or extra data) leaking to the UI.
    it("rejects invalid output with BAD_OUTPUT from the worker and from a rogue worker", async () => {
      const { link, client } = setup({
        procedures: { "overview.get": (() => ({ scanned: -1, toReview: 0 })) as never },
        subscriptions: {},
      });
      expect((await rejection(client.call("overview.get", {})))?.code).toBe("BAD_OUTPUT");
      link.close();

      const rogue = connect();
      rogue.server.onMessage((data) => {
        const { id } = data as { id: number };
        rogue.server.post({ kind: "result", id, output: { status: "hacked" } });
      });
      const client2 = createRpcClient(rogue.client);
      expect((await rejection(client2.call("app.state")))?.code).toBe("BAD_OUTPUT");
      rogue.close();
    });

    // Guards: handler errors (which may contain subjects or addresses) being forwarded to the renderer.
    it("hides handler error details behind HANDLER_FAILED", async () => {
      const { link, client } = setup({
        procedures: {
          "overview.get": () => {
            throw new Error("subject: secret@example.com");
          },
        },
        subscriptions: {},
      });
      const error = await rejection(client.call("overview.get", {}));
      expect(error?.code).toBe("HANDLER_FAILED");
      expect(error?.message).not.toContain("secret");
      link.close();
    });

    it("answers NOT_IMPLEMENTED for contract names without a handler yet", async () => {
      const { link, client } = setup({ procedures: {}, subscriptions: {} });
      expect((await rejection(client.call("digest.get", { accountId: "acc-1" })))?.code).toBe(
        "NOT_IMPLEMENTED",
      );
      link.close();
    });

    // Guards: leaking subscriptions (timers, listeners, DB watchers) when the renderer reloads or closes.
    it("tears subscriptions down when the port closes", async () => {
      const stop = vi.fn();
      const { link, client } = setup({
        procedures: {},
        subscriptions: { "app.events": () => stop },
      });
      client.subscribe("app.events", undefined, () => {});
      await sleep(30);
      expect(stop).not.toHaveBeenCalled();
      link.client.close();
      await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
      link.close();
    });

    // Guards: an unsubscribed screen still receiving (and paying for) events.
    it("stops a subscription on unsubscribe and delivers nothing afterwards", async () => {
      const stop = vi.fn();
      let emit: (event: { type: "ActionApplied"; actionId: string }) => void = () => {};
      const { link, client } = setup({
        procedures: {},
        subscriptions: {
          "app.events": (_input, push) => {
            emit = push;
            return stop;
          },
        },
      });
      const seen: unknown[] = [];
      const unsubscribe = client.subscribe("app.events", undefined, (event) => seen.push(event));
      await vi.waitFor(() => expect(emit).not.toBe(undefined));
      await sleep(20);
      unsubscribe();
      await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
      emit({ type: "ActionApplied", actionId: "late" });
      await sleep(120);
      expect(seen).toEqual([]);
      link.close();
    });

    // Guards: a pending call hanging forever when the worker dies or the port closes.
    it("rejects pending calls with CLOSED when the port closes, and TIMEOUT when the worker is silent", async () => {
      const link = connect();
      const client = createRpcClient(link.client, { timeoutMs: 5000 });
      const pending = rejection(client.call("app.state"));
      link.server.close();
      expect((await pending)?.code).toBe("CLOSED");
      link.close();

      const silent = connect();
      const quick = createRpcClient(silent.client, { timeoutMs: 20 });
      expect((await rejection(quick.call("app.state")))?.code).toBe("TIMEOUT");
      silent.close();
    });

    // Guards: prototype names (`constructor`, `__proto__`) resolving to something callable instead of an unknown procedure.
    it("answers UNKNOWN_PROCEDURE for unknown names including prototype keys", async () => {
      const { link } = setup({ procedures: {}, subscriptions: {} });
      const replies: { error?: { code: string } }[] = [];
      link.client.onMessage((data) => replies.push(data as never));
      for (const [i, name] of ["nope", "constructor", "__proto__", "toString"].entries())
        link.client.post({ kind: "call", id: i, procedure: name, input: undefined });
      await vi.waitFor(() => expect(replies).toHaveLength(4));
      expect(replies.map((reply) => reply.error?.code)).toEqual(Array(4).fill("UNKNOWN_PROCEDURE"));
      link.close();
    });

    // Guards: a malformed envelope without an id crashing the worker or getting an answer; it must keep serving.
    it("drops id-less malformed messages and keeps serving", async () => {
      const { link, client } = setup({
        procedures: {
          "app.state": () => ({ status: "ready" as const, hasConnectedAccount: false }),
        },
        subscriptions: {},
      });
      link.client.post("garbage");
      link.client.post({ kind: "call" });
      link.client.post(null);
      await expect(client.call("app.state")).resolves.toEqual({
        status: "ready",
        hasConnectedAccount: false,
      });
      link.close();
    });

    // Guards: unbounded strings and oversized messages reaching handlers (memory pressure from a compromised renderer).
    it("rejects over-long strings and oversize messages", async () => {
      const handler = vi.fn(() => ({ jobId: "j" }));
      const { link, client } = setup({ procedures: { "scan.start": handler }, subscriptions: {} });
      expect(
        (await rejection(client.call("scan.start", { accountId: "x".repeat(201) })))?.code,
      ).toBe("BAD_INPUT");
      const replies: { error?: { code: string } }[] = [];
      link.client.onMessage((data) => replies.push(data as never));
      link.client.post({
        kind: "call",
        id: 7,
        procedure: "scan.start",
        input: { accountId: "x".repeat(2_000_000) },
      });
      await vi.waitFor(() => expect(replies).toHaveLength(1));
      expect(replies[0]?.error?.code).toBe("BAD_INPUT");
      expect(handler).not.toHaveBeenCalled();
      link.close();
    });

    // Guards: a reused subscription id replacing a live subscription and leaking its handler.
    it("rejects a duplicate subscription id", async () => {
      const stop = vi.fn();
      const { link } = setup({ procedures: {}, subscriptions: { "app.events": () => stop } });
      const replies: { kind: string; error?: { code: string } }[] = [];
      link.client.onMessage((data) => replies.push(data as never));
      link.client.post({ kind: "subscribe", id: 1, topic: "app.events", input: undefined });
      link.client.post({ kind: "subscribe", id: 1, topic: "app.events", input: undefined });
      await vi.waitFor(() => expect(replies).toHaveLength(1));
      expect(replies[0]).toMatchObject({
        kind: "subscription-error",
        error: { code: "BAD_INPUT" },
      });
      link.close();
    });

    // Guards: a worker (or compromised peer) sending bad or free-text events; the screen must never see them.
    it("reports BAD_OUTPUT for an invalid event and never delivers it", async () => {
      const link = connect();
      const client = createRpcClient(link.client);
      const events: unknown[] = [];
      const errors: RpcError[] = [];
      let id = -1;
      link.server.onMessage((data) => {
        const message = data as { kind: string; id: number };
        if (message.kind === "subscribe") id = message.id;
      });
      client.subscribe(
        "app.events",
        undefined,
        (event) => events.push(event),
        (e) => errors.push(e),
      );
      await vi.waitFor(() => expect(id).toBe(0));
      link.server.post({
        kind: "batch",
        events: [
          {
            sub: id,
            data: { type: "ActionFailed", actionId: "a", reason: "free text with a subject" },
          },
        ],
      });
      await vi.waitFor(() => expect(errors).toHaveLength(1));
      expect(errors[0]?.code).toBe("BAD_OUTPUT");
      expect(events).toEqual([]);
      link.close();
    });

    // Guards: a throwing screen listener skipping the ack, which would stall the worker's window of 2 forever.
    it("acks every batch even when a listener throws, and still delivers the rest", async () => {
      const link = connect();
      const client = createRpcClient(link.client);
      const acks: unknown[] = [];
      const delivered: string[] = [];
      let id = -1;
      link.server.onMessage((data) => {
        const message = data as { kind: string; id: number };
        if (message.kind === "subscribe") id = message.id;
        if (message.kind === "ack") acks.push(message);
      });
      client.subscribe("app.events", undefined, (event) => {
        if (event.type === "ActionApplied") delivered.push(event.actionId);
        throw new Error("screen bug");
      });
      await vi.waitFor(() => expect(id).toBe(0));
      const applied = (actionId: string) => ({
        sub: id,
        data: { type: "ActionApplied", actionId },
      });
      link.server.post({ kind: "batch", events: [applied("1"), applied("2")] });
      link.server.post({ kind: "batch", events: [applied("3")] });
      await vi.waitFor(() => expect(acks).toHaveLength(2));
      expect(delivered).toEqual(["1", "2", "3"]);
      link.close();
    });

    // Guards: a renderer that stops acking making the worker buffer forever; the subscription must fail instead.
    it("fails the subscription with OVERFLOW when the renderer stops acking", async () => {
      const link = connect();
      let emit: (event: { type: "ActionApplied"; actionId: string }) => void = () => {};
      serveRpc(link.server, {
        procedures: {},
        subscriptions: {
          "app.events": (_input, push) => {
            emit = push;
            return undefined;
          },
        },
      });
      const errors: RpcError[] = [];
      const acking = false;
      // A stalled renderer: batches arrive, acks never go back.
      const stalled: Transport = {
        ...link.client,
        post: (message) => {
          if (!(message as { kind: string }).kind.startsWith("ack") || acking)
            link.client.post(message);
        },
      };
      createRpcClient(stalled).subscribe(
        "app.events",
        undefined,
        () => {},
        (e) => errors.push(e),
      );
      await vi.waitFor(() => expect(emit).not.toBe(undefined));
      await sleep(20);
      for (let i = 0; i < 7000; i++) emit({ type: "ActionApplied", actionId: String(i) });
      await vi.waitFor(() => expect(errors.map((e) => e.code)).toContain("OVERFLOW"));
      link.close();
    });
  });
};

import {
  CONNECT_CALL_TIMEOUT_MS,
  type EventOf,
  type InputOf,
  type OutputOf,
  type ProcedureName,
  procedureSchemas,
  type SubInputOf,
  type SubscriptionName,
  subscriptionSchemas,
} from "./contract.ts";
import { type ClientMessage, RpcError, serverMessageSchema } from "./protocol.ts";
import type { Transport } from "./transport.ts";

type Pending = {
  resolve: (output: unknown) => void;
  reject: (error: RpcError) => void;
  timer: ReturnType<typeof setTimeout>;
};
type Listener = {
  topic: SubscriptionName;
  onEvent: (event: never) => void;
  onError: ((error: RpcError) => void) | undefined;
};

/**
 * Renderer side. Validates input before it leaves the page and output/events before they reach a screen; every failure
 * is an `RpcError` with a stable code. Acks each batch after delivering it, which is what lets the worker keep sending.
 */
export const createRpcClient = (transport: Transport, options: { timeoutMs?: number } = {}) => {
  const timeoutMs = options.timeoutMs ?? 5000;
  let nextId = 0;
  let closed = false;
  const pending = new Map<number, Pending>();
  const listeners = new Map<number, Listener>();
  const post = (message: ClientMessage): void => {
    try {
      transport.post(message);
    } catch {
      shutdown();
      throw new RpcError("CLOSED", "worker connection closed");
    }
  };

  const shutdown = (): void => {
    if (closed) return;
    closed = true;
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new RpcError("CLOSED", "worker connection closed"));
      pending.delete(id);
    }
    for (const listener of listeners.values())
      listener.onError?.(new RpcError("CLOSED", "worker connection closed"));
    listeners.clear();
  };
  transport.onClose(shutdown);

  transport.onMessage((data) => {
    const message = serverMessageSchema.safeParse(data);
    if (!message.success) return;
    const value = message.data;
    if (value.kind === "result" || value.kind === "failure") {
      const entry = pending.get(value.id);
      if (entry === undefined) return;
      pending.delete(value.id);
      clearTimeout(entry.timer);
      if (value.kind === "result") entry.resolve(value.output);
      else entry.reject(new RpcError(value.error.code, value.error.message));
    } else if (value.kind === "batch") {
      try {
        for (const event of value.events) {
          const listener = listeners.get(event.sub);
          if (listener === undefined) continue;
          const checked = subscriptionSchemas(listener.topic)?.event.safeParse(event.data);
          if (checked?.success) {
            try {
              listener.onEvent(checked.data as never);
            } catch {
              // One screen's bug must not drop the rest of the batch.
              listener.onError?.(
                new RpcError("HANDLER_FAILED", `listener for ${listener.topic} threw`),
              );
            }
          } else
            listener.onError?.(new RpcError("BAD_OUTPUT", `invalid event on ${listener.topic}`));
        }
      } finally {
        // Always ack, even when a screen's listener throws: a missing ack would stall the worker's window for good.
        if (!closed) {
          try {
            post({ kind: "ack" });
          } catch {
            // The connection is gone; there is nowhere to ack to.
          }
        }
      }
    } else {
      listeners.get(value.sub)?.onError?.(new RpcError(value.error.code, value.error.message));
      listeners.delete(value.sub);
    }
  });

  return {
    call: <N extends ProcedureName>(
      name: N,
      ...args: InputOf<N> extends undefined ? [] : [InputOf<N>]
    ): Promise<OutputOf<N>> => {
      if (closed) return Promise.reject(new RpcError("CLOSED", "worker connection closed"));
      const schemas = procedureSchemas(name);
      if (schemas === undefined)
        return Promise.reject(new RpcError("UNKNOWN_PROCEDURE", "unknown procedure"));
      const input = schemas.input.safeParse(args[0]);
      if (!input.success)
        return Promise.reject(new RpcError("BAD_INPUT", `invalid input for ${name}`));
      return new Promise<OutputOf<N>>((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(
          () => {
            pending.delete(id);
            reject(new RpcError("TIMEOUT", "worker did not answer"));
          },
          name === "accounts.connect" || name === "accounts.reconnect"
            ? CONNECT_CALL_TIMEOUT_MS
            : timeoutMs,
        );
        pending.set(id, {
          timer,
          reject,
          resolve: (output) => {
            const checked = schemas.output.safeParse(output);
            if (checked.success) resolve(checked.data as OutputOf<N>);
            else reject(new RpcError("BAD_OUTPUT", `invalid output from ${name}`));
          },
        });
        try {
          post({ kind: "call", id, procedure: name, input: input.data });
        } catch (error) {
          pending.delete(id);
          clearTimeout(timer);
          reject(error as RpcError);
        }
      });
    },

    /** Returns the unsubscribe function. Throws `RpcError("BAD_INPUT")` synchronously when the input is invalid. */
    subscribe: <N extends SubscriptionName>(
      topic: N,
      input: SubInputOf<N>,
      onEvent: (event: EventOf<N>) => void,
      onError?: (error: RpcError) => void,
    ): (() => void) => {
      if (closed) throw new RpcError("CLOSED", "worker connection closed");
      const schemas = subscriptionSchemas(topic);
      const parsed = schemas?.input.safeParse(input);
      if (parsed === undefined || !parsed.success)
        throw new RpcError("BAD_INPUT", `invalid input for ${topic}`);
      const id = nextId++;
      listeners.set(id, { topic, onEvent: onEvent as (event: never) => void, onError });
      try {
        post({ kind: "subscribe", id, topic, input: parsed.data });
      } catch (error) {
        listeners.delete(id);
        throw error;
      }
      return () => {
        if (!listeners.delete(id) || closed) return;
        try {
          post({ kind: "unsubscribe", id });
        } catch {
          // The connection is gone; the worker will tear down on close.
        }
      };
    },
  };
};

export type RpcClient = ReturnType<typeof createRpcClient>;

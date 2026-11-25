import { AiUnavailable } from "@pochimail/classification/errors";
import type {
  AiError,
  Classification,
  Classifier,
  Embedder,
  LlmProvider,
} from "@pochimail/classification/ports/classifier";
import { type AsyncResult, type CancelSignal, createCancelSource } from "@pochimail/kernel/common";
import { Cancelled } from "@pochimail/kernel/errors";
import type { MessageId } from "@pochimail/kernel/ids";
import { err, ok } from "@pochimail/kernel/result";
import type { Timer } from "@pochimail/pipeline/event-batching";
import type { z } from "zod";
import type { Transport } from "../shared/ipc/transport.ts";
import {
  classificationsSchema,
  completionSchema,
  embeddingsSchema,
  type HostRequest,
  hostResponseSchema,
} from "../shared/model-host-protocol.ts";

type Body<M extends HostRequest["method"]> = Omit<
  Extract<HostRequest, { method: M }>,
  "id" | "method"
>;
type Pending = {
  readonly request: HostRequest;
  readonly settle: (result: ReturnType<typeof parse> | { ok: false; error: AiError }) => void;
  /** Cancels the "no host" deadline while the request sits on a live port. */
  cancelDeadline: (() => void) | undefined;
};

const parse = (data: unknown) => hostResponseSchema.safeParse(data);

export interface ModelHostClient {
  readonly classifier: Classifier;
  readonly llm: LlmProvider;
  readonly embedder: Embedder;
  /**
   * Main hands the worker a fresh port every time the host (re)starts. Requests that were waiting or in flight on the
   * previous port are sent again on this one, so a host crash is invisible to the scan (ADR 0002).
   */
  attach(transport: Transport): void;
  /** Tells the host to forget what it remembers of mail; resolves once it did, or at once if there is no host. */
  clearCache(): Promise<void>;
  /** Main stopped restarting the host: fail what waits, and every request until a new port arrives. */
  markUnavailable(): void;
}

/**
 * Worker side of the model host link. While no host is connected a request waits up to `waitMs` (a restart takes
 * seconds) and then fails as `AiUnavailable`, which the scan pipeline already treats as retryable.
 */
export const createModelHostClient = (options: {
  timer: Timer;
  waitMs?: number;
  embedderDimensions?: number;
}): ModelHostClient => {
  const waitMs = options.waitMs ?? 30_000;
  const pending = new Map<number, Pending>();
  let transport: Transport | undefined;
  let unavailable = false;
  let nextId = 0;

  const send = (entry: Pending): void => {
    entry.cancelDeadline?.();
    entry.cancelDeadline = undefined;
    try {
      transport?.post(entry.request);
    } catch {
      // The port just closed; the close handler below puts the request back to waiting.
    }
  };
  const armDeadline = (id: number, entry: Pending): void => {
    entry.cancelDeadline = options.timer.set(() => {
      pending.delete(id);
      entry.settle({ ok: false, error: new AiUnavailable() });
    }, waitMs);
  };

  const call = <M extends HostRequest["method"]>(
    method: M,
    body: Body<M>,
    signal: CancelSignal,
  ): Promise<ReturnType<typeof parse> | { ok: false; error: AiError }> =>
    new Promise((resolve) => {
      if (signal.aborted) return resolve({ ok: false, error: new Cancelled() });
      if (unavailable && !transport) return resolve({ ok: false, error: new AiUnavailable() });
      const id = nextId++;
      const entry: Pending = {
        request: { id, method, ...body } as unknown as HostRequest,
        settle: resolve,
        cancelDeadline: undefined,
      };
      pending.set(id, entry);
      const onAbort = (): void => {
        if (pending.delete(id)) {
          entry.cancelDeadline?.();
          resolve({ ok: false, error: new Cancelled() });
        }
      };
      signal.addEventListener("abort", onAbort, { once: true });
      if (transport) send(entry);
      else armDeadline(id, entry);
    });

  const asResult = async <T>(
    reply: Promise<ReturnType<typeof parse> | { ok: false; error: AiError }>,
    schema: z.ZodType<T>,
  ): AsyncResult<T, AiError> => {
    const answer = await reply;
    if ("error" in answer && !("success" in answer)) return err(answer.error);
    if (!("success" in answer) || !answer.success) return err(new AiUnavailable());
    const value = answer.data;
    if (!value.ok) return err(value.error === "cancelled" ? new Cancelled() : new AiUnavailable());
    const picked = schema.safeParse(value.result);
    return picked.success ? ok(picked.data) : err(new AiUnavailable());
  };

  const never = createCancelSource().signal;
  return {
    clearCache: async () => {
      await call("clear-cache", {}, never);
    },
    markUnavailable() {
      unavailable = true;
      for (const [id, entry] of pending) {
        entry.cancelDeadline?.();
        pending.delete(id);
        entry.settle({ ok: false, error: new AiUnavailable() });
      }
    },
    attach(next) {
      unavailable = false;
      transport = next;
      next.onMessage((data) => {
        if (transport !== next) return;
        const response = parse(data);
        if (!response.success) return;
        const entry = pending.get(response.data.id);
        if (!entry) return;
        pending.delete(response.data.id);
        entry.settle(response);
      });
      next.onClose(() => {
        if (transport !== next) return;
        transport = undefined;
        for (const [id, entry] of pending) armDeadline(id, entry);
      });
      for (const entry of pending.values()) send(entry);
    },
    classifier: {
      classify: (messages, signal) =>
        asResult(call("classify", { messages: [...messages] }, signal), classificationsSchema).then(
          (answer) =>
            answer.ok
              ? ok(
                  answer.value.map(
                    (c) => ({ ...c, messageId: c.messageId as MessageId }) as Classification,
                  ),
                )
              : answer,
        ),
    },
    llm: {
      complete: (request, signal) =>
        asResult(
          call(
            "complete",
            {
              prompt: request.prompt,
              ...(request.system === undefined ? {} : { system: request.system }),
              ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
            },
            signal,
          ),
          completionSchema,
        ),
    },
    embedder: {
      dimensions: options.embedderDimensions ?? 8,
      embed: (texts, signal) =>
        asResult(call("embed", { texts: [...texts] }, signal), embeddingsSchema).then((answer) =>
          answer.ok ? ok(answer.value.map((v) => Float32Array.from(v))) : answer,
        ),
    },
  };
};

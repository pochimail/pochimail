import { carryJsonSchema } from "@pochimail/ai/llm/json-schema";
import type { Classifier, Embedder } from "@pochimail/classification/ports/classifier";
import type { JsonLlmProvider } from "@pochimail/classification/ports/json-llm";
import { type CancelSignal, createCancelSource } from "@pochimail/kernel/common";
import type { Result } from "@pochimail/kernel/result";
import type { Transport } from "../shared/ipc/transport.ts";
import {
  type HostRequest,
  type HostResponse,
  hostRequestSchema,
} from "../shared/model-host-protocol.ts";

/** What the model host runs: the local models (ADR 0006), or stubs from the fake adapters (dev/E2E). */
export interface ModelHostEngine {
  /** Absent until the real classifier exists (M3): `classify` then answers `unavailable`. */
  readonly classifier?: Classifier;
  readonly llm: JsonLlmProvider;
  readonly embedder: Embedder;
  /** Forgets whatever the engine remembered of mail; absent when it remembers nothing. */
  readonly clearCache?: () => void;
}

type Work = Exclude<HostRequest, { method: "cancel" }>;

const errorName = (code: string): Extract<HostResponse, { ok: false }>["error"] => {
  if (code === "operation.cancelled") return "cancelled";
  return code === "ai.invalid_output" ? "invalid_output" : "unavailable";
};
const failure = (id: number, error: { code: string }): HostResponse => ({
  id,
  ok: false,
  error: errorName(error.code),
});
const answer = <T>(
  id: number,
  done: Result<T, { code: string }>,
  pick: (value: T) => unknown = (value) => value,
): HostResponse => (done.ok ? { id, ok: true, result: pick(done.value) } : failure(id, done.error));

const run = async (
  message: Work,
  engine: ModelHostEngine | undefined,
  signal: CancelSignal,
): Promise<HostResponse> => {
  if (engine === undefined) return failure(message.id, { code: "ai.unavailable" });
  switch (message.method) {
    case "classify":
      return engine.classifier === undefined
        ? failure(message.id, { code: "ai.unavailable" })
        : answer(message.id, await engine.classifier.classify(message.messages, signal));
    case "complete":
      return answer(
        message.id,
        await engine.llm.complete(
          {
            prompt: message.prompt,
            ...(message.system === undefined ? {} : { system: message.system }),
            ...(message.maxTokens === undefined ? {} : { maxTokens: message.maxTokens }),
          },
          signal,
        ),
      );
    case "completeJson":
      return answer(
        message.id,
        await engine.llm.completeJson(
          {
            prompt: message.prompt,
            schema: carryJsonSchema(message.jsonSchema),
            ...(message.system === undefined ? {} : { system: message.system }),
            ...(message.maxTokens === undefined ? {} : { maxTokens: message.maxTokens }),
          },
          signal,
        ),
      );
    case "embed":
      return answer(message.id, await engine.embedder.embed(message.texts, signal), (vectors) =>
        vectors.map((v) => [...v]),
      );
    case "clear-cache":
      engine.clearCache?.();
      return { id: message.id, ok: true, result: null };
  }
};

/**
 * Host side of the worker port: validates each request, runs it on the engine and answers. A bad message is dropped,
 * a `cancel` aborts the request it names, and an engine that throws is answered `unavailable`: the host never exits.
 */
export const serveModelHost = (transport: Transport, engine: ModelHostEngine | undefined): void => {
  const running = new Map<number, () => void>();
  const respond = (response: HostResponse): void => {
    try {
      transport.post(response);
    } catch {
      // The worker went away; nothing to answer.
    }
  };
  transport.onMessage((data) => {
    const request = hostRequestSchema.safeParse(data);
    if (!request.success) return;
    const message = request.data;
    if (message.method === "cancel") {
      running.get(message.id)?.();
      return;
    }
    const cancel = createCancelSource();
    running.set(message.id, cancel.abort);
    void run(message, engine, cancel.signal)
      .catch(() => failure(message.id, { code: "ai.unavailable" }))
      .then(respond)
      .finally(() => running.delete(message.id));
  });
};

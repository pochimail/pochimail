import type { Classifier, Embedder, LlmProvider } from "@pochimail/classification/ports/classifier";
import type { Transport } from "../shared/ipc/transport.ts";
import { type HostResponse, hostRequestSchema } from "../shared/model-host-protocol.ts";

/** What the model host runs. Until M3 these are stubs from the fake adapters (dev/E2E) or absent. */
export interface ModelHostEngine {
  readonly classifier: Classifier;
  readonly llm: LlmProvider;
  readonly embedder: Embedder;
  /** Forgets whatever the engine remembered of mail; absent when it remembers nothing. */
  readonly clearCache?: () => void;
}

const NEVER = { aborted: false, addEventListener: () => {}, removeEventListener: () => {} };

/** Host side of the worker port: validates each request, runs it on the engine and answers. A bad message is dropped. */
export const serveModelHost = (transport: Transport, engine: ModelHostEngine | undefined): void => {
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
    const unavailable = { id: message.id, ok: false, error: "unavailable" } as const;
    void (async () => {
      try {
        await answer();
      } catch {
        // An engine that throws instead of returning an error must not take the host down.
        respond(unavailable);
      }
    })();
    async function answer(): Promise<void> {
      if (engine === undefined) return respond(unavailable);
      if (message.method === "classify") {
        const done = await engine.classifier.classify(message.messages, NEVER);
        return respond(done.ok ? { id: message.id, ok: true, result: done.value } : unavailable);
      }
      if (message.method === "complete") {
        const done = await engine.llm.complete(
          {
            prompt: message.prompt,
            ...(message.system === undefined ? {} : { system: message.system }),
            ...(message.maxTokens === undefined ? {} : { maxTokens: message.maxTokens }),
          },
          NEVER,
        );
        return respond(done.ok ? { id: message.id, ok: true, result: done.value } : unavailable);
      }
      if (message.method === "clear-cache") {
        engine.clearCache?.();
        return respond({ id: message.id, ok: true, result: null });
      }
      const done = await engine.embedder.embed(message.texts, NEVER);
      respond(
        done.ok ? { id: message.id, ok: true, result: done.value.map((v) => [...v]) } : unavailable,
      );
    }
  });
};

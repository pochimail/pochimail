import { AiInvalidOutput, AiUnavailable } from "@pochimail/classification/errors";
import type { AiError, LlmRequest } from "@pochimail/classification/ports/classifier";
import type { JsonLlmProvider } from "@pochimail/classification/ports/json-llm";
import type { AsyncResult, CancelSignal } from "@pochimail/kernel/common";
import { Cancelled } from "@pochimail/kernel/errors";
import { err, ok } from "@pochimail/kernel/result";
import { createLimiter } from "../limiter.ts";
import { parseJsonOutput } from "./json-output.ts";
import { toJsonSchema } from "./json-schema.ts";
import type { Generation, JsonSchema, LlmRuntime, LoadedLlm } from "./llm-runtime.ts";

export interface LlmProviderOptions {
  runtime: LlmRuntime;
  /** The model file to load, or `undefined` when it is not on disk (the provider then answers `AiUnavailable`). */
  modelPath: () => Promise<string | undefined>;
  /** Generations that run at once on the one context. Default 1. */
  concurrency?: number;
  /** The model is unloaded after this long without a request. Default 5 minutes. */
  idleMs?: number;
  /** A generation that runs longer is stopped and answers `AiUnavailable`. Default 2 minutes. */
  timeoutMs?: number;
}

export interface LocalLlm extends JsonLlmProvider {
  /** Frees the model now (idle or memory pressure). Does nothing, and answers false, while a request is running. */
  unload(): Promise<boolean>;
}

const DEFAULT_MAX_TOKENS = 256;

const toGeneration = (request: LlmRequest, jsonSchema: JsonSchema | undefined): Generation => ({
  prompt: request.prompt,
  maxTokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
  ...(request.system === undefined ? {} : { system: request.system }),
  ...(jsonSchema === undefined ? {} : { jsonSchema }),
});

/** One generation under the caller's cancel and a deadline: both abort the runtime's signal. */
const decode = async (
  model: LoadedLlm,
  generation: Generation,
  signal: CancelSignal,
  timeoutMs: number,
): Promise<{ text: string; timedOut: boolean }> => {
  const controller = new AbortController();
  const stop = (): void => controller.abort();
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  signal.addEventListener("abort", stop, { once: true });
  try {
    const text = await model.generate(generation, controller.signal);
    return { text, timedOut };
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener("abort", stop);
  }
};

/**
 * The generative layer (ADR 0006): lazy load, one context, bounded concurrency, unload on idle. Nothing here logs or keeps
 * a prompt or an answer; a missing model, a crash and a timeout all answer `AiUnavailable`.
 */
export const createLlmProvider = (options: LlmProviderOptions): LocalLlm => {
  const concurrency = options.concurrency ?? 1;
  const idleMs = options.idleMs ?? 300_000;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const limiter = createLimiter(concurrency);
  let loaded: Promise<LoadedLlm | undefined> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const load = (): Promise<LoadedLlm | undefined> => {
    loaded ??= (async () => {
      const path = await options.modelPath();
      if (path === undefined) return undefined;
      try {
        return await options.runtime.load(path, concurrency);
      } catch {
        return undefined;
      }
    })().then((model) => {
      if (model === undefined) loaded = undefined;
      return model;
    });
    return loaded;
  };
  const discard = async (): Promise<void> => {
    const previous = loaded;
    loaded = undefined;
    try {
      await (await previous)?.dispose();
    } catch {
      // A model that fails to unload is already gone for our purposes.
    }
  };
  const unload = async (): Promise<boolean> => {
    if (limiter.pending > 0) return false;
    await discard();
    return true;
  };
  const armIdle = (): void => {
    idleTimer = setTimeout(() => void unload(), idleMs);
    idleTimer.unref();
  };

  const attempt = async (
    request: LlmRequest,
    jsonSchema: JsonSchema | undefined,
    signal: CancelSignal,
  ): AsyncResult<string, AiError> => {
    const model = await load();
    if (model === undefined) return err(new AiUnavailable());
    try {
      const { text, timedOut } = await decode(
        model,
        toGeneration(request, jsonSchema),
        signal,
        timeoutMs,
      );
      if (signal.aborted) return err(new Cancelled());
      return timedOut ? err(new AiUnavailable()) : ok(text);
    } catch {
      if (signal.aborted) return err(new Cancelled());
      // The context may be broken: the next request loads a fresh one.
      void discard();
      return err(new AiUnavailable());
    }
  };
  const generate = (
    request: LlmRequest,
    jsonSchema: JsonSchema | undefined,
    signal: CancelSignal,
  ): AsyncResult<string, AiError> =>
    limiter
      .run(signal, async () => {
        clearTimeout(idleTimer);
        try {
          return await attempt(request, jsonSchema, signal);
        } finally {
          if (limiter.pending === 1) armIdle();
        }
      })
      .then((ran) => (ran.ok ? ran.value : ran));

  return {
    unload,
    complete: (request, signal) => generate(request, undefined, signal),
    async completeJson(request, signal) {
      const jsonSchema = toJsonSchema(request.schema);
      const answered = await generate(request, jsonSchema, signal);
      if (!answered.ok) return answered;
      const parsed = request.schema.safeParse(parseJsonOutput(answered.value, jsonSchema));
      return parsed.success ? ok(parsed.data) : err(new AiInvalidOutput());
    },
  };
};

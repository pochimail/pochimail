import { AiInvalidOutput, AiUnavailable } from "@pochimail/classification/errors";
import type { AiError, LlmRequest } from "@pochimail/classification/ports/classifier";
import type { JsonLlmProvider } from "@pochimail/classification/ports/json-llm";
import type { AsyncResult, CancelSignal } from "@pochimail/kernel/common";
import { Cancelled } from "@pochimail/kernel/errors";
import { err, ok, type Result } from "@pochimail/kernel/result";
import { createLimiter } from "../limiter.ts";
import { parseJsonOutput } from "./json-output.ts";
import { toJsonSchema } from "./json-schema.ts";
import {
  type Generation,
  type JsonSchema,
  type LlmRuntime,
  type LoadedLlm,
  RequestRejected,
} from "./llm-runtime.ts";

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
/** How long a generation gets to react to an abort before the model is given up as hung. */
const ABORT_GRACE_MS = 5000;
const HUNG = Symbol("hung");

const toGeneration = (request: LlmRequest, jsonSchema: JsonSchema | undefined): Generation => ({
  prompt: request.prompt,
  maxTokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
  ...(request.system === undefined ? {} : { system: request.system }),
  ...(jsonSchema === undefined ? {} : { jsonSchema }),
});

/**
 * One generation under the caller's cancel and a deadline: both abort the runtime's signal. A runtime that has not
 * stopped `ABORT_GRACE_MS` after that is hung: `hung` tells the caller to discard the model.
 */
const decode = async (
  model: LoadedLlm,
  generation: Generation,
  signal: CancelSignal,
  timeoutMs: number,
): Promise<{ text: string; timedOut: boolean; hung: boolean }> => {
  const controller = new AbortController();
  const stop = (): void => controller.abort();
  let timedOut = false;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const grace = new Promise<typeof HUNG>((resolve) => {
    controller.signal.addEventListener(
      "abort",
      () => {
        graceTimer = setTimeout(() => resolve(HUNG), ABORT_GRACE_MS);
      },
      { once: true },
    );
  });
  signal.addEventListener("abort", stop, { once: true });
  try {
    const running = model.generate(generation, controller.signal);
    // Nobody awaits a generation we gave up on.
    running.catch(() => {});
    const text = await Promise.race([running, grace]);
    return text === HUNG ? { text: "", timedOut, hung: true } : { text, timedOut, hung: false };
  } finally {
    clearTimeout(deadline);
    clearTimeout(graceTimer);
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
  let disposing: Promise<void> = Promise.resolve();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const load = (): Promise<LoadedLlm | undefined> => {
    if (loaded !== undefined) return loaded;
    const started: Promise<LoadedLlm | undefined> = (async () => {
      // Never two models at once: wait for the one being freed.
      await disposing;
      const path = await options.modelPath();
      if (path === undefined) return undefined;
      try {
        return await options.runtime.load(path, concurrency);
      } catch {
        return undefined;
      }
    })().then((model) => {
      if (model === undefined && loaded === started) loaded = undefined;
      return model;
    });
    loaded = started;
    return started;
  };
  const discard = (): Promise<void> => {
    const previous = loaded;
    loaded = undefined;
    const freed = (async () => {
      try {
        await (await previous)?.dispose();
      } catch {
        // A model that fails to unload is already gone for our purposes.
      }
    })();
    disposing = Promise.all([disposing, freed]).then(() => undefined);
    return freed;
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

  const failed = (error: unknown, signal: CancelSignal): Result<string, AiError> => {
    if (signal.aborted) return err(new Cancelled());
    // A request the runtime cannot serve says nothing about the model; anything else may have broken the context.
    if (!(error instanceof RequestRejected)) void discard();
    return err(new AiUnavailable());
  };
  const attempt = async (
    request: LlmRequest,
    jsonSchema: JsonSchema | undefined,
    signal: CancelSignal,
  ): AsyncResult<string, AiError> => {
    const model = await load();
    if (signal.aborted) return err(new Cancelled());
    if (model === undefined) return err(new AiUnavailable());
    try {
      const { text, timedOut, hung } = await decode(
        model,
        toGeneration(request, jsonSchema),
        signal,
        timeoutMs,
      );
      if (hung) void discard();
      if (signal.aborted) return err(new Cancelled());
      return timedOut || hung ? err(new AiUnavailable()) : ok(text);
    } catch (error) {
      return failed(error, signal);
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

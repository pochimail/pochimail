import type { AsyncResult, CancelSignal } from "@pochimail/kernel/common";
import type { z } from "zod";
import type { AiInvalidOutput } from "../errors.ts";
import type { AiError, LlmProvider, LlmRequest } from "./classifier.ts";

export type JsonLlmError = AiError | AiInvalidOutput;

export interface JsonLlmRequest<T> extends LlmRequest {
  readonly schema: z.ZodType<T>;
}

/**
 * An `LlmProvider` that can also decode into a schema. The runtime is constrained to the schema's shape, and the
 * result is still parsed with the same schema: model output is untrusted, and a mismatch is `AiInvalidOutput`, never a guess.
 */
export interface JsonLlmProvider extends LlmProvider {
  completeJson<T>(request: JsonLlmRequest<T>, signal: CancelSignal): AsyncResult<T, JsonLlmError>;
}

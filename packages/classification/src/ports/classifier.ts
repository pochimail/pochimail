import type { AsyncResult, CancelSignal } from "@pochimail/kernel/common";
import type { Cancelled } from "@pochimail/kernel/errors";
import type { MessageId } from "@pochimail/kernel/ids";
import type { AiUnavailable } from "../errors.ts";
import type { EmailType } from "../model/email-type.ts";
import type { ClassifiableMessage } from "../model/message-facts.ts";

export type AiError = AiUnavailable | Cancelled;

export interface Classification {
  readonly messageId: MessageId;
  readonly category: EmailType;
  readonly confidence: number;
  readonly reasons: readonly string[];
  /** Rules or model version that decided; recorded with the decision. */
  readonly modelVersion?: string;
  readonly templateHash?: string;
  readonly embeddingRef?: string;
}

/**
 * Answers must be a pure function of `from`, `subject`, `snippet` and `hasListUnsubscribe`: the
 * classification cache (`@pochimail/ai/cache`) reuses an answer for any message with the same four,
 * so an implementation that also reads the id, date, recipients or time would return stale answers.
 */
export interface Classifier {
  classify(
    messages: readonly ClassifiableMessage[],
    signal: CancelSignal,
  ): AsyncResult<readonly Classification[], AiError>;
}

export interface Embedder {
  readonly dimensions: number;
  embed(
    texts: readonly string[],
    signal: CancelSignal,
  ): AsyncResult<readonly Float32Array[], AiError>;
}

export interface LlmRequest {
  readonly system?: string;
  readonly prompt: string;
  readonly maxTokens?: number;
}

/** Local model only. Output is untrusted text: callers validate it with zod. */
export interface LlmProvider {
  complete(request: LlmRequest, signal: CancelSignal): AsyncResult<string, AiError>;
}

import type { AsyncResult } from "@pochimail/kernel/common";
import type { NotFound, StorageError } from "@pochimail/kernel/errors";
import type { AccountId, MessageId, WorkspaceId } from "@pochimail/kernel/ids";
import { ok } from "@pochimail/kernel/result";
import type { SuspiciousFlag } from "../model/category.ts";
import { suspiciousRules } from "../policies/suspicious-rules.ts";
import type { SignalFactsSource } from "../ports/message-source.ts";

export interface EvaluateSuspiciousRequest {
  readonly workspaceId: WorkspaceId;
  readonly accountId: AccountId;
  readonly messageIds: readonly MessageId[];
}

export interface SuspiciousFinding {
  readonly messageId: MessageId;
  readonly flag: SuspiciousFlag;
}

/**
 * Reports the messages whose sender domain looked like phishing at ingest, unless the sender is trusted. Phishing is a flag on top of a type,
 * never a type (ADR 0016); this reports it without storing anything. Output is in message id order.
 */
export class EvaluateSuspicious {
  constructor(private readonly deps: { readonly signalFacts: SignalFactsSource }) {}

  async execute(
    request: EvaluateSuspiciousRequest,
  ): AsyncResult<SuspiciousFinding[], StorageError | NotFound> {
    const facts = await this.deps.signalFacts.forMessages(
      request.workspaceId,
      request.accountId,
      [...request.messageIds].sort(),
    );
    if (!facts.ok) return facts;
    return ok(
      facts.value.flatMap((f) => {
        const flag = suspiciousRules({ ...f, flag: f.suspicious });
        return flag === undefined ? [] : [{ messageId: f.messageId, flag }];
      }),
    );
  }
}

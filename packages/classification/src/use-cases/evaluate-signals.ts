import type { AsyncResult } from "@pochimail/kernel/common";
import type { NotFound, StorageError } from "@pochimail/kernel/errors";
import type { AccountId, MessageId, WorkspaceId } from "@pochimail/kernel/ids";
import { ok } from "@pochimail/kernel/result";
import { categoryOf } from "../model/category.ts";
import type { StoredSignal } from "../model/signal.ts";
import { DEFAULT_SIGNAL_SETTINGS, type SignalSettings } from "../model/signal-settings.ts";
import { IMPORTANT_REPLY_COUNT, signalRules } from "../policies/signal-rules.ts";
import type { DerivedReader } from "../ports/derived-repository.ts";
import type { SignalFactsSource } from "../ports/message-source.ts";

export interface EvaluateSignalsRequest {
  readonly workspaceId: WorkspaceId;
  readonly accountId: AccountId;
  readonly messageIds: readonly MessageId[];
}

/**
 * Evaluates the six signals for stored messages without storing or announcing anything. Reads
 * ids, dates, flags, counts and the derived decision only; it never reads a subject, snippet or
 * body (ADR 0014). Output is sorted, so a given mailbox, clock and settings always give the same
 * answer. A decision that cannot be made protects the email (ADR 0012).
 */
export class EvaluateSignals {
  constructor(
    private readonly deps: {
      readonly signalFacts: SignalFactsSource;
      readonly derived: DerivedReader;
      /** The age windows; the defaults when omitted. */
      readonly settings?: SignalSettings;
    },
  ) {}

  async execute(
    request: EvaluateSignalsRequest,
    now: Date,
  ): AsyncResult<StoredSignal[], StorageError | NotFound> {
    const { workspaceId: ws } = request;
    const facts = await this.deps.signalFacts.forMessages(
      ws,
      request.accountId,
      [...request.messageIds].sort(),
    );
    if (!facts.ok) return facts;
    const out: StoredSignal[] = [];
    for (const f of facts.value) {
      const derived = await this.deps.derived.get(ws, f.messageId);
      if (!derived.ok && derived.error.code !== "storage.not_found") return derived;
      for (const hit of signalRules({
        fromOwner: f.fromOwner,
        receivedAt: f.receivedAt,
        opened: f.opened,
        category: derived.ok ? derived.value.category : categoryOf({ category: f.storedCategory }),
        confidence: derived.ok ? derived.value.confidence : undefined,
        now,
        lastInThread: f.lastInThread,
        important: f.senderVip || f.senderRepliedCount >= IMPORTANT_REPLY_COUNT,
        hasListUnsubscribe: f.hasListUnsubscribe,
        attachmentCount: f.attachmentCount,
        settings: this.deps.settings ?? DEFAULT_SIGNAL_SETTINGS,
      }).sort((a, b) => (a.kind < b.kind ? -1 : 1))) {
        out.push({
          schemaVersion: 1,
          workspaceId: ws,
          messageId: f.messageId,
          kind: hit.kind,
          confidence: hit.confidence,
          detectedAt: now.toISOString(),
          reason: hit.reason,
        });
      }
    }
    return ok(out);
  }
}

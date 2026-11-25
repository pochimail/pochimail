import type { Clock } from "@pochimail/kernel/clock";
import type { AsyncResult, CancelSignal } from "@pochimail/kernel/common";
import type { Cancelled, NotFound, StorageError } from "@pochimail/kernel/errors";
import type { AccountId, MessageId, WorkspaceId } from "@pochimail/kernel/ids";
import { ok } from "@pochimail/kernel/result";
import type { SignalDetected } from "../events.ts";
import type { StoredSignal } from "../model/signal.ts";
import type { SignalSettings } from "../model/signal-settings.ts";
import type { ClassificationUnitOfWork } from "../ports/unit-of-work.ts";
import { EvaluateSignals } from "./evaluate-signals.ts";

export interface DetectSignalsDeps {
  readonly uow: ClassificationUnitOfWork;
  readonly clock: Clock;
  /** The age windows of the thread signals; the defaults when omitted. */
  readonly settings?: SignalSettings;
}

export interface DetectSignalsRequest {
  readonly workspaceId: WorkspaceId;
  readonly accountId: AccountId;
  readonly messageIds: readonly MessageId[];
}

export type DetectSignalsError = StorageError | NotFound | Cancelled;

export type MessageSignal = StoredSignal;

/**
 * Evaluates the six signals for stored messages (brief §3). Reads ids, dates, flags, counts and
 * the derived decision only; it never reads a subject, snippet or body (ADR 0014). Output is
 * sorted, so a given mailbox and clock always give the same answer. Each detection is announced
 * once through the outbox (`SignalDetected`, one stable id per message and kind).
 */
export class DetectSignals {
  constructor(private readonly deps: DetectSignalsDeps) {}

  async execute(
    request: DetectSignalsRequest,
    signal: CancelSignal,
  ): AsyncResult<readonly MessageSignal[], DetectSignalsError> {
    const { uow, clock } = this.deps;
    const detected = await new EvaluateSignals({
      ...uow.reads,
      ...(this.deps.settings ? { settings: this.deps.settings } : {}),
    }).execute(request, clock.now());
    if (!detected.ok) return detected;

    // Re-detection keeps the first `detectedAt` of a signal that still applies, so rows are stable.
    const ids = [...request.messageIds];
    const before = await uow.reads.signals.listForMessages(request.workspaceId, ids);
    if (!before.ok) return before;
    const firstSeen = new Map(before.value.map((s) => [`${s.messageId}:${s.kind}`, s.detectedAt]));
    const rows = detected.value.map((s) => ({
      ...s,
      detectedAt: firstSeen.get(`${s.messageId}:${s.kind}`) ?? s.detectedAt,
    }));

    const committed = await uow.run(async (tx) => {
      const saved = await tx.repositories.signals.replaceForMessages(
        request.workspaceId,
        ids,
        rows,
      );
      if (!saved.ok) return saved;
      for (const s of rows) {
        const event = {
          id: `signal:${s.messageId}:${s.kind}`,
          type: "SignalDetected",
          version: 1,
          workspaceId: s.workspaceId,
          occurredAt: s.detectedAt,
          payload: { messageId: s.messageId, kind: s.kind, confidence: s.confidence },
        } satisfies SignalDetected;
        const appended = await tx.events.append([event]);
        if (!appended.ok) return appended;
      }
      return ok(undefined);
    }, signal);
    if (!committed.ok) return committed;
    return ok(rows);
  }
}

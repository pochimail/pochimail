import type { Clock } from "@pochimail/kernel/clock";
import type { AsyncResult, CancelSignal } from "@pochimail/kernel/common";
import type { Cancelled, NotFound, StorageError } from "@pochimail/kernel/errors";
import type { MessageId, WorkspaceId } from "@pochimail/kernel/ids";
import { ok } from "@pochimail/kernel/result";
import type { MessageClassified } from "../events.ts";
import { DERIVED_SNIPPET_MAX_CHARS, type DerivedMessage } from "../model/derived.ts";
import { emailTypeSchema } from "../model/email-type.ts";
import type { ClassifiableMessage } from "../model/message-facts.ts";
import { confidenceSchema } from "../model/scores.ts";
import type { AiError, Classification, Classifier } from "../ports/classifier.ts";
import type { ClassificationUnitOfWork } from "../ports/unit-of-work.ts";

export interface ClassifyBatchDeps {
  readonly uow: ClassificationUnitOfWork;
  readonly classifier: Classifier;
  readonly clock: Clock;
}

export interface ClassifyBatchRequest {
  readonly workspaceId: WorkspaceId;
  readonly messageIds: readonly MessageId[];
}

export interface ClassifyBatchReport {
  readonly classified: number;
  /** Messages the classifier gave no usable answer for; they keep their category. */
  readonly unclassified: readonly MessageId[];
}

export type ClassifyBatchError = AiError | StorageError | NotFound | Cancelled;

/**
 * Classifies stored messages in one batch and records the category plus its derived data (reason, confidence, version, short snippet).
 *
 * Works on stored headers and metadata only: it never fetches or persists a body (follows
 * proposed D11). The category is set and `MessageClassified` is emitted in ONE transaction, so a
 * crash never leaves a category without its event. An unavailable classifier changes nothing.
 * Re-running with the same answers is a no-op in effect (same category, same event ids).
 */
export class ClassifyBatch {
  constructor(private readonly deps: ClassifyBatchDeps) {}

  async execute(
    request: ClassifyBatchRequest,
    signal: CancelSignal,
  ): AsyncResult<ClassifyBatchReport, ClassifyBatchError> {
    const { uow, classifier, clock } = this.deps;
    const messages: ClassifiableMessage[] = [];
    for (const id of request.messageIds) {
      const found = await uow.reads.messages.get(request.workspaceId, id);
      if (!found.ok) return found;
      messages.push(found.value);
    }
    if (messages.length === 0) return ok({ classified: 0, unclassified: [] });

    const answered = await classifier.classify(messages, signal);
    if (!answered.ok) return answered;

    const byId = new Map(messages.map((m) => [m.id, m]));
    const usable = new Map<
      MessageId,
      Classification & { accountId: ClassifiableMessage["accountId"] }
    >();
    for (const c of answered.value) {
      const message = byId.get(c.messageId);
      const category = emailTypeSchema.safeParse(c.category);
      if (!message || !category.success || !confidenceSchema.safeParse(c.confidence).success) {
        continue;
      }
      usable.set(c.messageId, { ...c, accountId: message.accountId });
    }

    const at = clock.now().toISOString();
    const committed = await uow.run(async (tx) => {
      for (const c of usable.values()) {
        const set = await tx.repositories.messages.setCategory(
          request.workspaceId,
          c.messageId,
          c.category,
        );
        if (!set.ok) return set;
        const message = byId.get(c.messageId);
        const derived: DerivedMessage = {
          schemaVersion: 1,
          workspaceId: request.workspaceId,
          accountId: c.accountId,
          messageId: c.messageId,
          category: c.category,
          reason: c.reasons.filter((r) => r.length > 0).join("; ") || "No reason given",
          confidence: c.confidence,
          modelVersion: c.modelVersion ?? "unknown",
          ...(c.templateHash ? { templateHash: c.templateHash } : {}),
          ...(c.embeddingRef ? { embeddingRef: c.embeddingRef } : {}),
          snippet: (message?.snippet ?? "").slice(0, DERIVED_SNIPPET_MAX_CHARS),
          derivedAt: at,
        };
        const saved = await tx.repositories.derived.save(derived);
        if (!saved.ok) return saved;
        const event = {
          id: `classified:${c.messageId}:${c.category}`,
          type: "MessageClassified",
          version: 1,
          workspaceId: request.workspaceId,
          occurredAt: at,
          payload: {
            accountId: c.accountId,
            messageId: c.messageId,
            category: c.category,
            confidence: c.confidence,
          },
        } satisfies MessageClassified;
        const appended = await tx.events.append([event]);
        if (!appended.ok) return appended;
      }
      return ok(undefined);
    }, signal);
    if (!committed.ok) return committed;

    return ok({
      classified: usable.size,
      unclassified: messages.map((m) => m.id).filter((id) => !usable.has(id)),
    });
  }
}

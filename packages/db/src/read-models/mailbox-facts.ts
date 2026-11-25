import type { DerivedReader } from "@pochimail/classification/ports/derived-repository";
import { EvaluateSignals } from "@pochimail/classification/use-cases/evaluate-signals";
import type { MailboxFacts } from "@pochimail/cleanup/ports/mailbox-facts";
import { ok } from "@pochimail/kernel/result";
import { type SignalFactsReads, signalFactsOver } from "./signal-facts.ts";

type Reads = SignalFactsReads & {
  readonly derived: DerivedReader;
  readonly figures: MailboxFacts["figures"];
};

/**
 * Cleanup's plain-data view of the mailbox, read from the
 * accounts, mailbox and derived rows, with signals evaluated by classification. Built from the stored rows;
 * the in-memory test store builds the same view.
 */
export function mailboxFactsOver(reads: Reads): MailboxFacts {
  const evaluate = new EvaluateSignals({
    signalFacts: signalFactsOver(reads),
    derived: reads.derived,
  });
  return {
    async accountIds(ws) {
      const accounts = await reads.accounts.list(ws);
      return accounts.ok ? ok(accounts.value.map((a) => a.id)) : accounts;
    },
    async query(ws, q) {
      const page = await reads.messages.query(ws, q);
      if (!page.ok) return page;
      return ok({
        items: page.value.items.map((m) => ({
          id: m.id,
          senderHash: m.senderHash,
          category: m.category,
          receivedAt: m.receivedAt,
          opened: m.opened,
          hasListUnsubscribe: m.hasListUnsubscribe,
          ...(m.size === undefined ? {} : { size: m.size }),
          ...(m.savedCount === undefined ? {} : { savedCount: m.savedCount }),
          ...(m.savedSize === undefined ? {} : { savedSize: m.savedSize }),
        })),
        nextCursor: page.value.nextCursor,
      });
    },
    latestSequence: (ws, accountId) => reads.messages.latestSequence(ws, accountId),
    figures: (ws, accountIds) => reads.figures(ws, accountIds),
    async decisions(ws, ids) {
      const found = await reads.derived.listForMessages(ws, ids);
      return found.ok
        ? ok(
            found.value.map((d) => ({
              messageId: d.messageId,
              reason: d.reason,
              confidence: d.confidence,
            })),
          )
        : found;
    },
    async signals(ws, accountId, ids, now) {
      const found = await evaluate.execute({ workspaceId: ws, accountId, messageIds: ids }, now);
      return found.ok
        ? ok(
            found.value.map((s) => ({
              messageId: s.messageId,
              kind: s.kind,
              confidence: s.confidence,
            })),
          )
        : found;
    },
  };
}

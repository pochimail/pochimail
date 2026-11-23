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
          from: m.from,
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
      const out = [];
      for (const id of ids) {
        const derived = await reads.derived.get(ws, id);
        if (!derived.ok && derived.error.code !== "storage.not_found") return derived;
        if (derived.ok)
          out.push({
            messageId: id,
            reason: derived.value.reason,
            confidence: derived.value.confidence,
          });
      }
      return ok(out);
    },
    async signals(ws, accountId, ids, now) {
      const found = await evaluate.execute({ workspaceId: ws, accountId, messageIds: ids }, now);
      return found.ok
        ? ok(found.value.map((s) => ({ messageId: s.messageId, kind: s.kind })))
        : found;
    },
  };
}

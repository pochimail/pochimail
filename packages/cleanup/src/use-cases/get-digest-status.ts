import type { AccountId } from "@pochimail/kernel/ids";
import type { DigestStatus, DigestTally } from "../ports/digest-tally.ts";

const emptyStatus = (): DigestStatus => ({
  ready: false,
  itemCount: 0,
  archived: 0,
  saved: 0,
  unsubscribed: 0,
});

/** Sums each account's latest items once; the newest date wins, so the header names no stale digest. */
const sum = (statuses: readonly DigestStatus[]): DigestStatus =>
  statuses.reduce<DigestStatus>(
    (total, status) => ({
      ready: total.ready || status.ready,
      itemCount: total.itemCount + status.itemCount,
      archived: total.archived + status.archived,
      saved: total.saved + status.saved,
      unsubscribed: total.unsubscribed + status.unsubscribed,
      generatedAt:
        status.generatedAt !== undefined &&
        (total.generatedAt === undefined || status.generatedAt > total.generatedAt)
          ? status.generatedAt
          : total.generatedAt,
    }),
    emptyStatus(),
  );

/** What one account's digest button shows, or the All-accounts Summary's summed latest digests. */
export class GetDigestStatus {
  constructor(private readonly deps: { readonly tally: DigestTally }) {}

  execute(accountId: AccountId | undefined): DigestStatus {
    return accountId === undefined
      ? sum(this.deps.tally.statuses())
      : this.deps.tally.status(accountId);
  }
}

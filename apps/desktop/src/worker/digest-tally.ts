import type { DigestStatus, DigestTally } from "@pochimail/cleanup/ports/digest-tally";
import type { AccountId } from "@pochimail/kernel/ids";

const empty = (): DigestStatus => ({
  ready: false,
  itemCount: 0,
  archived: 0,
  saved: 0,
  unsubscribed: 0,
});

/** Each account's newest digest's new-item figures, in memory for the life of the worker. */
export function createDigestTally(): DigestTally {
  const seen = new Set<string>();
  const byAccount = new Map<AccountId, DigestStatus>();
  return {
    record(eventId, digest) {
      if (seen.has(eventId)) return;
      seen.add(eventId);
      const current = byAccount.get(digest.accountId) ?? empty();
      if (
        current.generatedAt !== undefined &&
        digest.generatedAt !== undefined &&
        digest.generatedAt < current.generatedAt
      )
        return;
      byAccount.set(digest.accountId, {
        ready: digest.itemCount > 0,
        itemCount: digest.itemCount,
        archived: digest.archived ?? 0,
        saved: digest.saved ?? 0,
        unsubscribed: digest.unsubscribed ?? 0,
        ...(digest.generatedAt === undefined ? {} : { generatedAt: digest.generatedAt }),
      });
    },
    status: (accountId) => byAccount.get(accountId) ?? empty(),
    statuses: () => [...byAccount.values()],
  };
}

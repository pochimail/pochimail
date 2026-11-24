import type { DigestStatus, DigestTally } from "@pochimail/cleanup/ports/digest-tally";

/** The newest digest's new-item figures, kept in memory for the life of the worker. */
export function createDigestTally(): DigestTally {
  const seen = new Set<string>();
  let current: DigestStatus = {
    ready: false,
    itemCount: 0,
    archived: 0,
    saved: 0,
    unsubscribed: 0,
  };
  return {
    record(eventId, digest) {
      if (seen.has(eventId)) return;
      seen.add(eventId);
      if (
        current.generatedAt !== undefined &&
        digest.generatedAt !== undefined &&
        digest.generatedAt < current.generatedAt
      )
        return;
      current = {
        ready: digest.itemCount > 0,
        itemCount: digest.itemCount,
        archived: digest.archived ?? 0,
        saved: digest.saved ?? 0,
        unsubscribed: digest.unsubscribed ?? 0,
        ...(digest.generatedAt === undefined ? {} : { generatedAt: digest.generatedAt }),
      };
    },
    status: () => current,
  };
}

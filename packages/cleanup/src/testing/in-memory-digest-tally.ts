import type { DigestStatus, DigestTally } from "../ports/digest-tally.ts";

/** Counts in memory: the newest digest's new items only; nothing survives the process. */
export function createInMemoryDigestTally(): DigestTally {
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

import type { DigestFigures } from "../model/digest.ts";

export interface DigestStatus extends DigestFigures {
  readonly ready: boolean;
  readonly itemCount: number;
}

/** Older events omit figures, so every field but the item count can be explicitly undefined. */
export type DigestTallyInput = {
  readonly [K in keyof DigestFigures]?: DigestFigures[K] | undefined;
} & { readonly itemCount: number };

/**
 * What the digest button and the Summary read: the newest digest's new items only.
 * Cumulative action figures belong to the Overview, not here.
 */
export interface DigestTally {
  /** Counts a delivered `DigestReady` once; the same event id again changes nothing. */
  record(eventId: string, digest: DigestTallyInput): void;
  status(): DigestStatus;
}

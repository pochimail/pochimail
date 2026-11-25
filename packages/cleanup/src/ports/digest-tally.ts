import type { AccountId } from "@pochimail/kernel/ids";
import type { DigestFigures } from "../model/digest.ts";

export interface DigestStatus extends DigestFigures {
  readonly ready: boolean;
  readonly itemCount: number;
}

/** Older events omit figures, so every field but the account and item count can be explicitly undefined. */
export type DigestTallyInput = {
  readonly [K in keyof DigestFigures]?: DigestFigures[K] | undefined;
} & {
  readonly accountId: AccountId;
  readonly itemCount: number;
};

/**
 * What each account's digest button and Summary read: the newest digest's new items only.
 * Cumulative action figures belong to the Overview, not here.
 */
export interface DigestTally {
  /** Counts a delivered `DigestReady` once; the same event id again changes nothing. */
  record(eventId: string, digest: DigestTallyInput): void;
  status(accountId: AccountId): DigestStatus;
  /** Each account's newest digest, for the All-accounts Summary. */
  statuses(): readonly DigestStatus[];
}

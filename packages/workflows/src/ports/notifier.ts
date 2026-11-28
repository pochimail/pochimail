import type { AsyncResult } from "@pochimail/kernel/common";
import type { StorageError } from "@pochimail/kernel/errors";

export const NOTIFICATION_KINDS = ["digest-ready", "scan-complete", "review-waiting"] as const;

/** Counts only: names and subjects never go into a notification unless the user opts in. */
export interface Notification {
  readonly kind: (typeof NOTIFICATION_KINDS)[number];
  readonly count: number;
}

export interface Notifier {
  notify(notification: Notification): AsyncResult<void, StorageError>;
}

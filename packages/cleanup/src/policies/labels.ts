/** Types the Overview counts, and Pochi may propose to clean, as mail nobody wrote to you: in tie-break order. */
export const CLEANABLE_LABELS = ["newsletter", "promotion", "notification"] as const;
export type CleanableLabel = (typeof CLEANABLE_LABELS)[number];

/** Signals worth interrupting someone for; the rest stay in the Overview (brief §7). */
export const ATTENTION_SIGNALS: readonly string[] = [
  "needs-reply",
  "time-sensitive",
  "important-sender",
  "has-document",
];

/**
 * An email carrying any of these, at any confidence, is never proposed for cleanup (ADR 0012).
 * Protection reads signals only: no type name appears here, so a misfiled email stays protected.
 */
export const PROTECTING_SIGNALS: readonly string[] = [...ATTENTION_SIGNALS, "waiting-on-them"];

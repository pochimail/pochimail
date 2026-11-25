import { SUSPICIOUS_REASONS } from "@pochimail/classification/policies/suspicious-rules";

const KNOWN: readonly string[] = Object.values(SUSPICIOUS_REASONS);
/** What any other reason is stored as: a flag from elsewhere may carry free text, which is never kept (ADR 0014). */
const OTHER = "other";

const known = (reason: string) => (KNOWN.includes(reason) ? reason : OTHER);

/** The fixed reason codes as they are, comma-separated in one column; any other text becomes `other`. */
export const encodeReasons = (reasons: readonly string[]): string =>
  [...new Set(reasons.map(known))].join(",");

export const decodeReasons = (stored: string): string[] => [
  ...new Set(stored.split(",").map(known)),
];

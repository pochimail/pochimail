import type { SuspiciousFlag } from "../model/category.ts";

export interface SuspiciousInput {
  readonly from: string;
  readonly senderVip: boolean;
  readonly senderRepliedCount: number;
}

const SUSPICIOUS_CONFIDENCE = 0.8;

/** A 1 or 0 between letters imitates an l or an o ("examp1e"). */
const LOOKALIKE_LABEL = /[a-z]{2,}[01][a-z]+/;

/**
 * Phishing flag from the sender's domain and reply history only (ADR 0014: no subject, snippet or
 * body). A sender the user marked VIP or ever replied to is trusted and never flagged; a missing
 * or unreadable address is not flagged either, since the flag only warns and never protects.
 * Reasons are fixed codes, never mail content.
 */
export function suspiciousRules(i: SuspiciousInput): SuspiciousFlag | undefined {
  if (i.senderVip || i.senderRepliedCount > 0) return undefined;
  const domain = i.from.split("@")[1]?.toLowerCase();
  if (domain === undefined || domain === "") return undefined;
  const labels = domain.split(".");
  const reasons: string[] = [];
  if (labels.some((l) => l.startsWith("xn--"))) reasons.push("punycode-domain");
  if (labels.some((l) => l.split("-").some((part) => LOOKALIKE_LABEL.test(part))))
    reasons.push("lookalike-domain");
  return reasons.length === 0 ? undefined : { reasons, confidence: SUSPICIOUS_CONFIDENCE };
}

import { UNSURE_BELOW } from "@pochimail/kernel/confidence";
import type { EmailType } from "../model/email-type.ts";
import type { SignalKind } from "../model/signal.ts";
import type { SignalSettings } from "../model/signal-settings.ts";

const DAY_MS = 86_400_000;
/** Unopened bulk mail older than this is "old and never opened". */
export const OLD_AFTER_DAYS = 30;
/** A sender we replied to this often is important even without a VIP mark. */
export const IMPORTANT_REPLY_COUNT = 3;
/** Confidence of a signal raised only because a gate was unsure. */
export const UNSURE_CONFIDENCE = 0.5;
/** "Deadlines this week": a recent unopened notice is time-sensitive for this long. */
export const TIME_SENSITIVE_WITHIN_DAYS = 7;
/** Automated mail whose silence is what makes a clean-up proposal safe. */
export const BULK_TYPES: readonly EmailType[] = ["notification", "newsletter", "promotion"];

export interface RuleInput {
  /** Whether the owner sent it; `undefined` when the sender is unknown. */
  readonly fromOwner: boolean | undefined;
  readonly receivedAt: string;
  readonly opened: boolean;
  readonly category: EmailType;
  /** The classifier's confidence in `category`; `undefined` when no decision was recorded. */
  readonly confidence: number | undefined;
  readonly now: Date;
  readonly lastInThread: boolean;
  readonly important: boolean;
  readonly hasListUnsubscribe: boolean;
  /** Attachments the provider reported; `undefined` when it did not. */
  readonly attachmentCount: number | undefined;
  readonly settings: SignalSettings;
}
export interface Hit {
  readonly kind: SignalKind;
  readonly confidence: number;
  readonly reason: string;
}

/** One gate of a rule: a fact is known to hold, known not to, or cannot be decided. */
type Verdict = "yes" | "no" | "unsure";

/**
 * The verdict of a rule is "no" when any gate is certainly false, "unsure" when none is false but
 * one cannot be decided, and "yes" otherwise.
 *
 * Follows ADR 0012: "when the classifier is unsure, the email is protected". An unsure gate
 * therefore still raises the protecting signal, at UNSURE_CONFIDENCE and with a fixed reason; it
 * never silences it. Rules stay pure and never read subjects, snippets or bodies (ADR 0014).
 */
function combine(...gates: Verdict[]): Verdict {
  if (gates.includes("no")) return "no";
  return gates.includes("unsure") ? "unsure" : "yes";
}

function hit(kind: SignalKind, verdict: Verdict, confidence: number, reason: string): Hit[] {
  if (verdict === "no") return [];
  return verdict === "yes"
    ? [{ kind, confidence, reason }]
    : [{ kind, confidence: UNSURE_CONFIDENCE, reason: `Not sure, kept safe: ${reason}` }];
}

/** A fact that is known: it holds or it does not. */
const known = (holds: boolean): Verdict => (holds ? "yes" : "no");

/** The classifier's answer is usable: it recorded a decision and was sure enough. */
const decided = (i: RuleInput): boolean =>
  i.confidence !== undefined && i.confidence >= UNSURE_BELOW;

/** Is this the thread of a real person? Automated mail (List-Unsubscribe) never is. */
function person(i: RuleInput): Verdict {
  if (i.hasListUnsubscribe) return "no";
  if (!decided(i)) return "unsure";
  return known(i.category === "personal");
}

/** Is this one of a given set of types? An unsure classifier cannot say. */
function typeIn(i: RuleInput, types: readonly EmailType[]): Verdict {
  return decided(i) ? known(types.includes(i.category)) : "unsure";
}

function sentByOwner(i: RuleInput): Verdict {
  return i.fromOwner === undefined ? "unsure" : known(i.fromOwner);
}

const not = (v: Verdict): Verdict => (v === "unsure" ? v : known(v === "no"));

/** The age of the message in days, or `undefined` when its date cannot be read. */
function ageDays(i: RuleInput): number | undefined {
  const at = Date.parse(i.receivedAt);
  return Number.isNaN(at) ? undefined : (i.now.getTime() - at) / DAY_MS;
}

const between = (age: number | undefined, min: number, max: number): Verdict =>
  age === undefined ? "unsure" : known(age >= min && age <= max);

/** The six signals of one message. Pure: the same input always gives the same hits. */
export function signalRules(i: RuleInput): Hit[] {
  const age = ageDays(i);
  const owner = sentByOwner(i);
  const last = known(i.lastInThread);
  const { recentDays, waitingAfterDays } = i.settings;
  const oldUnopenedBulk = combine(
    typeIn(i, BULK_TYPES),
    known(!i.opened),
    between(age, OLD_AFTER_DAYS, Infinity),
  );

  return [
    ...hit(
      "needs-reply",
      combine(last, not(owner), person(i), between(age, -Infinity, recentDays)),
      0.8,
      "A person wrote last and you have not answered",
    ),
    ...hit(
      "waiting-on-them",
      combine(last, owner, person(i), between(age, waitingAfterDays, recentDays)),
      0.8,
      `You wrote last, ${waitingAfterDays}+ days ago, with no answer`,
    ),
    ...hit(
      "important-sender",
      combine(known(i.important), known(owner !== "yes")),
      0.9,
      "You often reply to this sender or marked them VIP",
    ),
    // ADR 0012: an unknown attachment count may hide a document, so it protects.
    ...hit(
      "has-document",
      i.attachmentCount === undefined ? "unsure" : known(i.attachmentCount > 0),
      0.9,
      "Carries an attachment",
    ),
    // Text-free proxy for "time-sensitive": a deadline cannot be read without the subject or
    // body, which are not stored (ADR 0014). Until dates are extracted from display fields
    // fetched on demand, a recent unopened transactional email counts, and so does any recent
    // unopened message whose type is unsure, because ADR 0012 protects "Time-sensitive".
    ...hit(
      "time-sensitive",
      combine(
        typeIn(i, ["transactional"]),
        known(!i.opened),
        between(age, -Infinity, TIME_SENSITIVE_WITHIN_DAYS),
      ),
      0.6,
      "A recent unopened notice may have a deadline",
    ),
    // Old and never opened only proposes clean-up, so an unsure gate never raises it.
    ...hit(
      "old-never-opened",
      known(oldUnopenedBulk === "yes"),
      0.95,
      `Unopened for ${OLD_AFTER_DAYS}+ days`,
    ),
  ];
}

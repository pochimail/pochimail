import type { EmailType } from "@pochimail/classification/model/email-type";
import type { Sender } from "./content.ts";
import type { Language } from "./content-types.ts";
import { DAY } from "./fixture-draws.ts";
import type { SignalPlan } from "./signal-labels.ts";

// FAKE DATA ONLY. Hard cases whose labels are decided here, from how the case is built, never by
// running the rules: a recent unopened statement with no deadline is not time-sensitive, a recent
// thread that ends with a thank-you needs no reply, and a legitimate domain with a digit is not
// phishing. The rules cannot tell these from the real thing without reading text (ADR 0014), so
// they score as false alarms: the eval is a regression guard, not an accuracy estimate.

/** How many cases of each kind are planted; fixed, so the labels never depend on the scale. */
const CASES = 3;

type Plan = SignalPlan & {
  language: Language;
  subject: string;
  body: string;
  peer: Sender;
  suspicious: boolean;
};

const NOTICE: Record<Language, { subject: string; body: string }> = {
  en: {
    subject: "Your statement is available",
    body: "Your monthly statement is available online.",
  },
  fr: {
    subject: "Votre relevé est disponible",
    body: "Votre relevé mensuel est disponible en ligne.",
  },
  ja: { subject: "明細のご案内", body: "月次の明細をオンラインでご確認いただけます。" },
};
const CLOSING: Record<Language, string> = {
  en: "Thanks, all done on my side. No reply needed.",
  fr: "Merci, tout est réglé de mon côté. Pas besoin de répondre.",
  ja: "ありがとうございました。返信は不要です。",
};

const SPOOFED: readonly Sender[] = [
  { name: "Security", address: "security@xn--pypal-4ve.example.net" },
  { name: "Accounts", address: "no-reply@acc0unt-verify.example.net" },
  { name: "Support", address: "help@secure-m1crosoft.example.net" },
];
/** Legitimate senders whose domain has a digit: the rule must not flag `web3` or `s3`. */
const LEGIT_DIGITS: readonly Sender[] = [
  { name: "Web3 Updates", address: "no-reply@web3.example.net" },
  { name: "Storage Status", address: "alerts@s3-status.example.net" },
  { name: "Inbox 1st", address: "team@inbox1st.example.net" },
];

const byThread = (plans: readonly Plan[], category: EmailType) => {
  const threads = new Map<number, Plan[]>();
  for (const plan of plans)
    if (plan.category === category)
      threads.set(plan.threadKey, [...(threads.get(plan.threadKey) ?? []), plan]);
  return [...threads.values()];
};

const lastOf = (thread: readonly Plan[]) =>
  thread.reduce((a, b) => (b.at > a.at || (b.at === a.at && b.pos > a.pos) ? b : a));

/**
 * Plants the hard cases in place and returns the thread keys that need no reply, which the thread
 * labels must skip. Off (`enabled` false), nothing changes: the demo mock keeps the design's
 * figures (7 people waiting, 3 deadlines). Deterministic and free of random draws, so the rest of
 * the mailbox keeps its shape. Picks only threads nothing else has labelled.
 */
export function plantNegatives(
  plans: readonly Plan[],
  now: number,
  recentDays: number,
  enabled: boolean,
): ReadonlySet<number> {
  if (!enabled) return new Set();
  const noticeAge = [1, 3, 5];
  const planted = new Set<number>();
  byThread(plans, "transactional")
    .filter((t) => t.length === 1 && t[0]?.signals.size === 0 && now - (t[0]?.at ?? now) > 7 * DAY)
    .slice(0, CASES)
    .forEach(([plan], i) => {
      if (plan === undefined) return;
      planted.add(plan.threadKey);
      plan.at = now - (noticeAge[i] ?? 1) * DAY;
      plan.opened = false;
      Object.assign(plan, NOTICE[plan.language]);
    });

  const noReply = new Set<number>();
  for (const thread of byThread(plans, "personal")) {
    if (noReply.size >= CASES) break;
    const last = lastOf(thread);
    const quiet = thread.every((p) => p.signals.size === 0);
    if (!quiet || !last.inbound || now - last.at <= recentDays * DAY) continue;
    const shift = now - (2 + noReply.size) * DAY - last.at;
    for (const plan of thread) plan.at += shift;
    last.body = CLOSING[last.language];
    noReply.add(last.threadKey);
  }

  byThread(plans, "transactional")
    .filter((t) =>
      t.every((p) => !p.suspicious && p.signals.size === 0 && !planted.has(p.threadKey)),
    )
    .slice(0, SPOOFED.length + LEGIT_DIGITS.length)
    .forEach((thread, i) => {
      const spoofed = i < SPOOFED.length;
      const peer = spoofed ? SPOOFED[i] : LEGIT_DIGITS[i - SPOOFED.length];
      for (const plan of thread) Object.assign(plan, { peer, suspicious: spoofed });
    });
  return noReply;
}

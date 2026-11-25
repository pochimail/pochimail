import type { Category, SignalKind } from "@pochimail/classification/model/category";
import type { SignalSettings } from "@pochimail/classification/model/signal-settings";
import { TIME_SENSITIVE_WITHIN_DAYS } from "@pochimail/classification/policies/signal-rules";

const DAY = 86_400_000;

/** What the thread labels read of one planned message. */
export interface SignalPlan {
  readonly category: Category;
  readonly threadKey: number;
  readonly pos: number;
  readonly inbound: boolean;
  at: number;
  opened: boolean;
  readonly signals: Set<SignalKind>;
}

/**
 * Ground truth of the thread signals, from the thread's shape and the clock alone (the rules read
 * stored facts instead). Only a person's recent thread can wait: on you when their message is the
 * last one, on them once your last message is `waitingAfterDays` old.
 */
export function assignThreadSignals(
  plans: readonly SignalPlan[],
  now: number,
  settings: SignalSettings,
  noReply: ReadonlySet<number> = new Set(),
): void {
  const lastOfThread = new Map<number, SignalPlan>();
  for (const plan of plans) {
    const last = lastOfThread.get(plan.threadKey);
    if (last === undefined || plan.at > last.at || (plan.at === last.at && plan.pos > last.pos))
      lastOfThread.set(plan.threadKey, plan);
  }
  for (const plan of lastOfThread.values()) {
    if (plan.category !== "people" || noReply.has(plan.threadKey)) continue;
    const age = (now - plan.at) / DAY;
    if (age > settings.recentDays) continue;
    if (plan.inbound) plan.signals.add("needs-reply");
    else if (age >= settings.waitingAfterDays) plan.signals.add("waiting-on-them");
  }
}

/** Any recent records notice that is not a deadline was read, so only a deadline notice is recent and unopened. */
export function markRecentRecordsRead(plans: readonly SignalPlan[], now: number): void {
  for (const plan of plans)
    if (
      plan.category === "records" &&
      !plan.signals.has("time-sensitive") &&
      now - plan.at <= TIME_SENSITIVE_WITHIN_DAYS * DAY
    )
      plan.opened = true;
}

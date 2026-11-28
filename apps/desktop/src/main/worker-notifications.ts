import { t } from "@pochimail/ui/i18n/format.ts";
import type { UserLocale } from "@pochimail/ui/i18n/messages.ts";
import {
  type NotificationScreen,
  type NotifyMessage,
  notifyMessageSchema,
} from "../shared/notifications.ts";

/** One notification per kind per window (ADR 0008), and no more than a day's cap in any 24 hours. */
export const COALESCE_WINDOW_MS = 15 * 60_000;
export const DAILY_CAP = 10;
const DAY_MS = 24 * 60 * 60_000;

/** Quiet hours (ADR 0008): from 22:00 to 08:00 local time nothing is shown. */
const QUIET_FROM_HOUR = 22;
const QUIET_UNTIL_HOUR = 8;
const isQuiet = (at: number): boolean => {
  const hour = new Date(at).getHours();
  return hour >= QUIET_FROM_HOUR || hour < QUIET_UNTIL_HOUR;
};

const SCREEN_OF_KIND: Record<NotifyMessage["kind"], NotificationScreen> = {
  "scan-complete": "overview",
  "digest-ready": "review",
  "review-waiting": "review",
};

export interface ShownNotification {
  on(event: "click" | "close", listener: () => void): unknown;
  show(): void;
}

/**
 * Shows the worker's notifications as OS notifications. Anything that is not a valid notify message is dropped,
 * and so is a notification inside the limits above. The text is a kind and a count only (ADR 0014); a click
 * asks the app to open the matching screen.
 */
export const showWorkerNotifications = (options: {
  readonly worker: { on(event: "message", listener: (message: unknown) => void): unknown };
  /** Undefined when the OS cannot show notifications. */
  readonly create: (content: { title: string; body: string }) => ShownNotification | undefined;
  readonly now: () => number;
  readonly osLocale: UserLocale;
  readonly open: (screen: NotificationScreen) => void;
}): void => {
  const lastByKind = new Map<string, number>();
  // The OS may drop its click and close events when the object is garbage collected, so each one is kept until it ends.
  const alive = new Set<ShownNotification>();
  let shownAt: number[] = [];
  options.worker.on("message", (message) => {
    const parsed = notifyMessageSchema.safeParse(message);
    if (!parsed.success) return;
    const { kind, count, locale } = parsed.data;
    const now = options.now();
    if (isQuiet(now)) return;
    shownAt = shownAt.filter((at) => now - at < DAY_MS);
    const last = lastByKind.get(kind);
    if (shownAt.length >= DAILY_CAP || (last !== undefined && now - last < COALESCE_WINDOW_MS))
      return;
    const text = { locale: locale ?? options.osLocale };
    const notification = options.create({
      title: t(`notify.${kind}.title`, undefined, text),
      body: t(`notify.${kind}.body`, { count }, text),
    });
    if (notification === undefined) return;
    lastByKind.set(kind, now);
    shownAt.push(now);
    alive.add(notification);
    notification.on("click", () => {
      alive.delete(notification);
      options.open(SCREEN_OF_KIND[kind]);
    });
    notification.on("close", () => void alive.delete(notification));
    notification.show();
  });
};

import { NOTIFICATION_KINDS } from "@pochimail/workflows/ports/notifier";
import { z } from "zod";
import { SETTINGS_LOCALES } from "./settings.ts";

/**
 * The one message from the worker to main about a Pochimail notification (ADR 0008): one way, no reply. It carries
 * a kind and a count, never a name, subject or address (ADR 0014), and the saved language so main can word it.
 * Main validates it and limits how often it is shown.
 */
export const notifyMessageSchema = z.object({
  type: z.literal("notify"),
  kind: z.enum(NOTIFICATION_KINDS),
  count: z.number().int().nonnegative(),
  locale: z.enum(SETTINGS_LOCALES).nullable(),
});
export type NotifyMessage = z.infer<typeof notifyMessageSchema>;

/** The screens a notification can open; main tells the page which one, and nothing else. */
export const NOTIFICATION_SCREENS = ["overview", "review"] as const;
export const notificationScreenSchema = z.enum(NOTIFICATION_SCREENS);
export type NotificationScreen = z.infer<typeof notificationScreenSchema>;
export const openScreenChannel = "notifications:open-screen";

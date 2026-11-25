import { z } from "zod";

/**
 * The age windows of the thread signals, in days. A thread is "recent" while its last message is
 * at most `recentDays` old: only recent threads can be waiting on you or on them. A thread you
 * answered becomes "waiting on them" after `waitingAfterDays` of silence.
 */
export const signalSettingsSchema = z
  .object({
    recentDays: z.int().positive(),
    waitingAfterDays: z.int().positive(),
  })
  .refine((s) => s.waitingAfterDays <= s.recentDays, {
    message: "waitingAfterDays cannot exceed recentDays",
  });
export type SignalSettings = z.infer<typeof signalSettingsSchema>;

export const DEFAULT_SIGNAL_SETTINGS: SignalSettings = signalSettingsSchema.parse({
  recentDays: 14,
  waitingAfterDays: 3,
});

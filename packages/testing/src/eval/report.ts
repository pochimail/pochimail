import { EMAIL_TYPES } from "@pochimail/classification/model/email-type";
import { SIGNAL_KINDS } from "@pochimail/classification/model/signal";
import { z } from "zod";
import { classMetricsSchema } from "./metrics.ts";

export const evalReportSchema = z.object({
  schemaVersion: z.literal(1),
  fixture: z.object({
    seed: z.int(),
    scale: z.enum(["small", "full"]),
    messages: z.int().nonnegative(),
  }),
  /** Messages the classifier gave no usable answer for. */
  unclassified: z.int().nonnegative(),
  categoryAccuracy: z.number().min(0).max(1),
  categories: z.record(z.enum(EMAIL_TYPES), classMetricsSchema),
  signals: z.record(z.enum(SIGNAL_KINDS), classMetricsSchema),
  /** The phishing flag, scored on its own: it is a flag on top of a type, not a signal. */
  suspicious: classMetricsSchema,
});
export type EvalReport = z.infer<typeof evalReportSchema>;

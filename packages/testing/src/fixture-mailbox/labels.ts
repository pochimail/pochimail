import { EMAIL_TYPES } from "@pochimail/classification/model/email-type";
import { SIGNAL_KINDS } from "@pochimail/classification/model/signal";
import { z } from "zod";

export const LANGUAGES = ["en", "fr", "ja"] as const;
export const SUGGESTION_KINDS = ["archive", "unsubscribe"] as const;

export const messageLabelSchema = z.object({
  messageId: z.string().min(1),
  accountId: z.string().min(1),
  threadId: z.string().min(1),
  category: z.enum(EMAIL_TYPES),
  signals: z.array(z.enum(SIGNAL_KINDS)),
  language: z.enum(LANGUAGES),
  /** Phishing is a flag on top of a type, never a type (ADR 0016). */
  suspicious: z.boolean(),
  /** What a correct assistant proposes for this message; `null` when it must propose nothing. */
  expectedSuggestion: z.enum(SUGGESTION_KINDS).nullable(),
});
export type MessageLabel = z.infer<typeof messageLabelSchema>;

export const labelsFileSchema = z.object({
  schemaVersion: z.literal(1),
  seed: z.int(),
  scale: z.enum(["small", "full"]),
  totals: z.object({
    messages: z.int().nonnegative(),
    documents: z.int().nonnegative(),
    /** Combined declared size of the documents in bytes (#114); a number, never a name. */
    attachmentBytes: z.int().nonnegative(),
    byCategory: z.record(z.enum(EMAIL_TYPES), z.int().nonnegative()),
  }),
  messages: z.array(messageLabelSchema),
});
export type LabelsFile = z.infer<typeof labelsFileSchema>;

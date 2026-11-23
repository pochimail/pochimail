import { CATEGORIES, SIGNAL_KINDS } from "@pochimail/classification/model/category";
import { z } from "zod";

export const LANGUAGES = ["en", "fr", "ja"] as const;
export const SUGGESTION_KINDS = ["archive", "unsubscribe"] as const;

export const messageLabelSchema = z.object({
  messageId: z.string().min(1),
  accountId: z.string().min(1),
  threadId: z.string().min(1),
  category: z.enum(CATEGORIES),
  signals: z.array(z.enum(SIGNAL_KINDS)),
  language: z.enum(LANGUAGES),
  /** Phishing is a flag on top of a category, never a category (brief §3). */
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
    byCategory: z.record(z.enum(CATEGORIES), z.int().nonnegative()),
  }),
  messages: z.array(messageLabelSchema),
});
export type LabelsFile = z.infer<typeof labelsFileSchema>;

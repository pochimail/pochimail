import {
  accountIdSchema,
  messageIdSchema,
  schemaVersion,
  timestampSchema,
  workspaceIdSchema,
} from "@pochimail/kernel/schemas";
import { z } from "zod";

/**
 * The "what's new" summary (brief §7): only mail that arrived after `since`, never totals of
 * old mail. Holds ids, counts and signal kinds, no subjects or addresses. Categories and signal
 * kinds are labels owned by classification; this domain only counts and passes them on.
 */
export const digestSchema = z.object({
  schemaVersion,
  workspaceId: workspaceIdSchema,
  accountId: accountIdSchema,
  since: timestampSchema,
  generatedAt: timestampSchema,
  newMessageCount: z.int().nonnegative(),
  byCategory: z.partialRecord(z.string().min(1), z.int().positive()),
  /** New messages that need attention, with the signal that says why. */
  attention: z.array(z.object({ messageId: messageIdSchema, kind: z.string().min(1) })),
});
export type Digest = z.infer<typeof digestSchema>;

/**
 * The three new-item figures a digest announces, plus when it was generated. Counts come from the
 * digest's new mail (never cumulative Overview totals); the date is optional for older events.
 */
export const digestFiguresSchema = z.object({
  archived: z.int().nonnegative(),
  saved: z.int().nonnegative(),
  unsubscribed: z.int().nonnegative(),
  generatedAt: timestampSchema.optional(),
});
export type DigestFigures = z.infer<typeof digestFiguresSchema>;

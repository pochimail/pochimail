import {
  accountIdSchema,
  messageIdSchema,
  schemaVersion,
  threadIdSchema,
  timestampSchema,
  topicIdSchema,
  workspaceIdSchema,
} from "@pochimail/kernel/schemas";
import { z } from "zod";

// PRIVATE MAIL DATA: Message and Thread hold subjects, addresses and snippets.
// Never log them, and never add their field names to the logger's safe-key allow-list.

/** A fetched message before classification: no category yet. */
export const incomingMessageSchema = z.object({
  schemaVersion,
  id: messageIdSchema,
  workspaceId: workspaceIdSchema,
  accountId: accountIdSchema,
  threadId: threadIdSchema,
  from: z.email(),
  to: z.array(z.email()),
  subject: z.string(),
  snippet: z.string(),
  receivedAt: timestampSchema,
  hasListUnsubscribe: z.boolean(),
  opened: z.boolean(),
  /** The provider's size estimate in bytes, when it reports one (for "space you can free"). */
  size: z.int().nonnegative().optional(),
  /** How many attachments the message carries; a number only, never a name (ADR 0014). */
  savedCount: z.int().nonnegative().optional(),
  /** Their combined size in bytes, when the provider reports one. */
  savedSize: z.int().nonnegative().optional(),
  topicIds: z.array(topicIdSchema),
  /** A phishing flag the provider or a later stage raised; never a category. */
  suspicious: z
    .object({
      reasons: z.array(z.string().min(1)).min(1),
      confidence: z.number().min(0).max(1),
    })
    .optional(),
});
export type IncomingMessage = z.infer<typeof incomingMessageSchema>;

/** A stored message: the label is opaque here, classification owns the closed set. */
export const messageSchema = incomingMessageSchema.extend({
  category: z.string(),
  /** The keyed sender digest stored with the message (ADR 0014); empty when the sender is unknown. */
  senderHash: z.string(),
  /** Whether an applied archive action left the message out of the inbox; the action log owns it. */
  archived: z.boolean().optional(),
});
export type Message = z.infer<typeof messageSchema>;

import type { MessageId } from "@pochimail/kernel/ids";
import {
  accountIdSchema,
  messageIdSchema,
  threadIdSchema,
  timestampSchema,
} from "@pochimail/kernel/schemas";
import { z } from "zod";

// PRIVATE MAIL DATA: subjects, addresses and snippets. Never log them.

/** What classification reads of a stored message: headers and metadata, never a body. */
export const classifiableMessageSchema = z.object({
  id: messageIdSchema,
  accountId: accountIdSchema,
  threadId: threadIdSchema,
  from: z.email(),
  to: z.array(z.email()),
  subject: z.string(),
  snippet: z.string(),
  receivedAt: timestampSchema,
  hasListUnsubscribe: z.boolean(),
  opened: z.boolean(),
});
export type ClassifiableMessage = z.infer<typeof classifiableMessageSchema>;

/** Everything the signal rules need about one message, as plain data from the mailbox. */
export interface SignalFacts {
  readonly messageId: MessageId;
  /** The sender's address; empty when it is no longer known (ADR 0014), which the rules treat as unsure. */
  readonly from: string;
  /** The label stored on the message; narrowed here, the mailbox does not know the closed set. */
  readonly storedCategory: string;
  readonly receivedAt: string;
  readonly opened: boolean;
  readonly ownerAddress: string;
  /** True when the message ends its thread (a message without a stored thread is a thread of one). */
  readonly lastInThread: boolean;
  readonly senderVip: boolean;
  readonly senderRepliedCount: number;
  readonly hasListUnsubscribe: boolean;
  /** How many attachments the provider reported; absent when it did not. */
  readonly attachmentCount?: number;
}

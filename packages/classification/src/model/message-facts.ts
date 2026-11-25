import type { MessageId } from "@pochimail/kernel/ids";
import {
  accountIdSchema,
  messageIdSchema,
  threadIdSchema,
  timestampSchema,
} from "@pochimail/kernel/schemas";
import { z } from "zod";
import type { SuspiciousFlag } from "./category.ts";

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
  /** Whether the owner sent it, worked out at ingest from the stored sender hash (ADR 0014); `undefined` when the sender is unknown, which the rules treat as unsure. */
  readonly fromOwner: boolean | undefined;
  /** The domain flag stored at ingest, before the trust check; classification never sees an address. */
  readonly suspicious?: SuspiciousFlag;
  /** The label stored on the message; narrowed here, the mailbox does not know the closed set. */
  readonly storedCategory: string;
  readonly receivedAt: string;
  readonly opened: boolean;
  /** True when the message ends its thread (a message without a stored thread is a thread of one). */
  readonly lastInThread: boolean;
  readonly senderVip: boolean;
  readonly senderRepliedCount: number;
  readonly hasListUnsubscribe: boolean;
  /** How many attachments the provider reported; absent when it did not. */
  readonly attachmentCount?: number;
}

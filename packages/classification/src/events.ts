import { defineEvent } from "@pochimail/kernel/event-schema";
import { accountIdSchema, messageIdSchema } from "@pochimail/kernel/schemas";
import { z } from "zod";
import { emailTypeSchema } from "./model/email-type.ts";
import { confidenceSchema } from "./model/scores.ts";
import { signalKindSchema } from "./model/signal.ts";

export const messageClassifiedEvent = defineEvent(
  "MessageClassified",
  z.object({
    accountId: accountIdSchema,
    messageId: messageIdSchema,
    category: emailTypeSchema,
    confidence: confidenceSchema,
  }),
);
export const signalDetectedEvent = defineEvent(
  "SignalDetected",
  z.object({ messageId: messageIdSchema, kind: signalKindSchema, confidence: confidenceSchema }),
);
export const classificationEvents = [messageClassifiedEvent, signalDetectedEvent] as const;

export type MessageClassified = z.infer<typeof messageClassifiedEvent>;
export type SignalDetected = z.infer<typeof signalDetectedEvent>;

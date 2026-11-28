import {
  messageIdSchema,
  schemaVersion,
  timestampSchema,
  workspaceIdSchema,
} from "@pochimail/kernel/schemas";
import { z } from "zod";
import { confidenceSchema } from "./scores.ts";

export const SIGNAL_KINDS = [
  "needs-reply",
  "waiting-on-them",
  "important-sender",
  "has-document",
  "time-sensitive",
  "old-never-opened",
] as const;
export const signalKindSchema = z.enum(SIGNAL_KINDS);
export type SignalKind = z.infer<typeof signalKindSchema>;

export const signalSchema = z.object({
  schemaVersion,
  workspaceId: workspaceIdSchema,
  messageId: messageIdSchema,
  kind: signalKindSchema,
  confidence: confidenceSchema,
  detectedAt: timestampSchema,
});
export type Signal = z.infer<typeof signalSchema>;

/**
 * A signal as stored. The rule's reason text exists only in the process that detected it; a row
 * read after a restart has no reason, and stored codes are never passed off as text (ADR 0014).
 */
export type StoredSignal = Signal & { readonly reason?: string };

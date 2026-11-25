import {
  accountIdSchema,
  messageIdSchema,
  schemaVersion,
  timestampSchema,
  workspaceIdSchema,
} from "@pochimail/kernel/schemas";
import { z } from "zod";
import { emailTypeSchema } from "./email-type.ts";
import { confidenceSchema } from "./scores.ts";

// PRIVATE MAIL DATA: `snippet` is a few characters of a message. Never log it.

/** Derived data keeps a short excerpt at most (proposed D11: never persist full bodies). */
export const DERIVED_SNIPPET_MAX_CHARS = 120;

/**
 * What the assistant derived about one message, with the reason and confidence the UI needs to
 * explain the decision (brief §3). Derived data only: no body, no attachment content.
 */
export const derivedMessageSchema = z.object({
  schemaVersion,
  workspaceId: workspaceIdSchema,
  accountId: accountIdSchema,
  messageId: messageIdSchema,
  category: emailTypeSchema,
  reason: z.string().min(1),
  confidence: confidenceSchema,
  /** Which rules or model version decided, so a decision can be redone when it changes. */
  modelVersion: z.string().min(1),
  /** Normalized subject/body template hash, so a template is classified once (brief §3). */
  templateHash: z.string().min(1).optional(),
  /** Opaque reference to the embedding kept by the embedding store; never the vector. */
  embeddingRef: z.string().min(1).optional(),
  snippet: z.string().max(DERIVED_SNIPPET_MAX_CHARS),
  derivedAt: timestampSchema,
});
export type DerivedMessage = z.infer<typeof derivedMessageSchema>;

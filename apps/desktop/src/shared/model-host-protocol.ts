import { EMAIL_TYPES } from "@pochimail/classification/model/email-type";
import { classifiableMessageSchema } from "@pochimail/classification/model/message-facts";
import { z } from "zod";

/**
 * Messages between the worker and the model host process (ADR 0002). The host is a separate utilityProcess so a model crash
 * or out-of-memory kill never takes the worker (and its database) down. Both ends validate every message.
 */
const id = z.number().int().nonnegative();
const MAX_SCHEMA_CHARS = 20_000;
const jsonSchema = z.record(z.string(), z.unknown()).refine((schema) => {
  try {
    return JSON.stringify(schema).length <= MAX_SCHEMA_CHARS;
  } catch {
    // A cycle or a BigInt: not JSON, so not a schema.
    return false;
  }
});

export const hostRequestSchema = z.discriminatedUnion("method", [
  z.object({
    id,
    method: z.literal("classify"),
    messages: z.array(classifiableMessageSchema).max(500),
  }),
  z.object({
    id,
    method: z.literal("complete"),
    prompt: z.string().max(100_000),
    system: z.string().max(100_000).optional(),
    maxTokens: z.number().int().positive().optional(),
  }),
  z.object({
    id,
    method: z.literal("completeJson"),
    prompt: z.string().max(100_000),
    system: z.string().max(100_000).optional(),
    maxTokens: z.number().int().positive().optional(),
    /** The shape the answer is decoded into; the worker parses the answer with its own zod schema. */
    jsonSchema,
  }),
  z.object({ id, method: z.literal("embed"), texts: z.array(z.string().max(100_000)).max(500) }),
  /** Stops request `id` on the engine; no answer. */
  z.object({ id, method: z.literal("cancel") }),
  /** Drops what the host remembers of mail (the classification cache); sent on account removal and lock. */
  z.object({ id, method: z.literal("clear-cache") }),
]);
export type HostRequest = z.infer<typeof hostRequestSchema>;

export const classificationsSchema = z.array(
  z.object({
    messageId: z.string().min(1),
    category: z.enum(EMAIL_TYPES),
    confidence: z.number().min(0).max(1),
    reasons: z.array(z.string()),
    modelVersion: z.string().optional(),
    templateHash: z.string().optional(),
    embeddingRef: z.string().optional(),
  }),
);
export const completionSchema = z.string();
export const embeddingsSchema = z.array(z.array(z.number()));

export const hostResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    id,
    ok: z.literal(true),
    /** Checked by the caller against the schema of the method it asked. */
    result: z.unknown(),
  }),
  /** `unavailable`: no model is loaded (or it failed); the worker treats it as `AiUnavailable`. `invalid_output`: the model's answer was not JSON. */
  z.object({
    id,
    ok: z.literal(false),
    error: z.enum(["unavailable", "cancelled", "invalid_output"]),
  }),
]);
export type HostResponse = z.infer<typeof hostResponseSchema>;

/** Control messages between main and the host process itself (not the worker port). */
export const hostControlSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("port") }),
  z.object({ type: z.literal("ping"), n: id }),
]);
export const hostPongSchema = z.object({ type: z.literal("pong"), n: id });

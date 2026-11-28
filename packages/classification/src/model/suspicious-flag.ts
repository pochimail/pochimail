import { z } from "zod";
import { confidenceSchema, reasonsSchema } from "./scores.ts";

/** Phishing is a flag on top of any type, never a type (ADR 0016). */
export const suspiciousFlagSchema = z.object({
  reasons: reasonsSchema,
  confidence: confidenceSchema,
});
export type SuspiciousFlag = z.infer<typeof suspiciousFlagSchema>;

import { z } from "zod";
import type { JsonSchema } from "./llm-runtime.ts";

/** A zod schema as the JSON schema that constrains decoding; the same schema parses the answer. */
export const toJsonSchema = (schema: z.ZodType): JsonSchema => {
  const { $schema: _draft, ...jsonSchema } = z.toJSONSchema(schema, { io: "output" });
  return jsonSchema;
};

/**
 * A schema that stands for a JSON schema sent from another process: `toJsonSchema` gives it back unchanged, and it
 * accepts any JSON value, because the process that owns the real zod schema parses the answer with it.
 */
export const carryJsonSchema = (jsonSchema: JsonSchema): z.ZodType<unknown> =>
  z
    .unknown()
    .refine((value) => value !== undefined)
    .meta(jsonSchema);

import type { JsonSchema } from "./llm-runtime.ts";

/**
 * With `thoughtTokens: 0`, node-llama-cpp 3.22.3 returns Qwen3.5's grammar-constrained object without its opening
 * brace (ADR 0006, Known limits). The brace is restored for object schemas before parsing; the zod parse that follows
 * still decides whether the result is accepted.
 */
export const parseJsonOutput = (text: string, jsonSchema: JsonSchema): unknown => {
  const trimmed = text.trimStart();
  const restored =
    jsonSchema.type === "object" && !trimmed.startsWith("{") ? `{${trimmed}` : trimmed;
  try {
    return JSON.parse(restored);
  } catch {
    return undefined;
  }
};

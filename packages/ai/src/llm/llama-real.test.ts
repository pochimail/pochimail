import {
  jsonLlmProviderContract,
  llmProviderContract,
} from "@pochimail/classification/testing/ai-contract";
import { live } from "@pochimail/classification/testing/samples";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { extractDeadline } from "./deadline-extraction.ts";
import { createLlamaRuntime } from "./llama-runtime.ts";
import { createLlmProvider } from "./llm-provider.ts";

// Opt-in: set POCHIMAIL_LLM_MODEL to a Qwen3.5 GGUF file (ADR 0006 benchmark model). Skipped in CI, which has no model.
const modelFile = process.env.POCHIMAIL_LLM_MODEL;

describe.skipIf(modelFile === undefined)("real model", () => {
  const llm = createLlmProvider({
    runtime: createLlamaRuntime(),
    modelPath: async () => modelFile,
    timeoutMs: 120_000,
  });
  afterAll(() => llm.unload());

  llmProviderContract(() => llm);
  jsonLlmProviderContract(() => llm);

  // Guards: ADR 0006 known limit: with thoughtTokens 0, Qwen3.5 returns the object without its opening brace.
  it("returns a parsed object for an object schema", async () => {
    const out = await llm.completeJson(
      {
        system: 'Answer with JSON only, like {"category":"people"}.',
        prompt: "Sort this email: 'Lunch tomorrow?' from a friend. Categories: people, records.",
        schema: z.object({ category: z.enum(["people", "records"]) }),
      },
      live(),
    );
    expect(out.ok).toBe(true);
  });

  // Guards: prompts that make the model invent a deadline, in each language.
  it.each([
    ["English", "Your order will arrive on March 3. Thanks for shopping with us.", "2027-03-03"],
    ["French", "Votre facture est à régler avant le 3 mars. Merci.", "2027-03-03"],
    ["Japanese", "ご注文の商品は12月5日にお届けします。", "2027-12-05"],
    ["no date", "Thanks for your message, talk soon!", null],
  ])("extracts the deadline from a %s email", async (_language, text, expected) => {
    const out = await extractDeadline(
      llm,
      { type: "purchases-travel", signals: [], received: "2027-02-20", text },
      live(),
    );
    expect(out).toEqual({ ok: true, value: expected });
  });

  // Guards: a long email overflowing the 2048-token context (the provider would answer unavailable).
  it("extracts the deadline from a 10,000-character email", async () => {
    const text = `Your invoice is due on 3 March. ${"Thank you for being a customer. ".repeat(320)}`;
    expect(text.length).toBeGreaterThan(10_000);
    const out = await extractDeadline(
      llm,
      { type: "purchases-travel", signals: [], received: "2027-02-20", text },
      live(),
    );
    expect(out).toEqual({ ok: true, value: "2027-03-03" });
  });

  // Guards: "January 5" in a December mail read as a date in the past.
  it("reads a date without a year as the next one", async () => {
    const out = await extractDeadline(
      llm,
      {
        type: "purchases-travel",
        signals: [],
        received: "2027-12-20",
        text: "Offer ends January 5.",
      },
      live(),
    );
    expect(out).toEqual({ ok: true, value: "2028-01-05" });
  });
});

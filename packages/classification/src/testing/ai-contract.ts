import { unwrap } from "@pochimail/kernel/result";
import { type Check, check, registerContract } from "@pochimail/kernel/testing/contract";
import { expect } from "vitest";
import { z } from "zod";
import { EMAIL_TYPES } from "../model/email-type.ts";
import type { Classifier, Embedder, LlmProvider } from "../ports/classifier.ts";
import type { JsonLlmProvider } from "../ports/json-llm.ts";
import type { TopicDiscoverer } from "../ports/topic-discoverer.ts";
import { aborted, live, makeMessage } from "./samples.ts";

const cancelled = (r: { ok: boolean; error?: { code: string } }) => {
  expect(r.ok).toBe(false);
  expect(r.error?.code).toBe("operation.cancelled");
};

export const classifierChecks: readonly Check<Classifier>[] = [
  check(
    "returns one valid classification per message, in order (guards misaligned or invalid results)",
    async (c) => {
      const messages = [makeMessage(1), makeMessage(2, { hasListUnsubscribe: true })];
      const out = unwrap(await c.classify(messages, live()));
      expect(out.map((x) => x.messageId)).toEqual(messages.map((m) => m.id));
      for (const x of out) {
        expect(EMAIL_TYPES).toContain(x.category);
        expect(x.confidence).toBeGreaterThanOrEqual(0);
        expect(x.confidence).toBeLessThanOrEqual(1);
        expect(x.reasons.length).toBeGreaterThan(0);
      }
    },
  ),
  check("an empty batch is an empty result (guards an error on nothing to do)", async (c) => {
    expect(unwrap(await c.classify([], live()))).toEqual([]);
  }),
  check(
    "an aborted signal is Cancelled (guards classification continuing after cancel)",
    async (c) => {
      cancelled(await c.classify([makeMessage(1)], aborted()));
    },
  ),
];

export const embedderChecks: readonly Check<Embedder>[] = [
  check(
    "returns one vector of `dimensions` per text (guards vectors the index cannot store)",
    async (e) => {
      const out = unwrap(await e.embed(["a", "bb", "ccc"], live()));
      expect(out).toHaveLength(3);
      for (const v of out) expect(v.length).toBe(e.dimensions);
    },
  ),
  check("the same text gives the same vector (guards duplicate-detection drift)", async (e) => {
    const [a, b] = unwrap(await e.embed(["weekly update", "weekly update"], live()));
    expect(Array.from(a ?? [])).toEqual(Array.from(b ?? []));
  }),
  check(
    "different texts give different vectors (guards a constant embedder hiding similarity bugs)",
    async (e) => {
      const [a, b] = unwrap(await e.embed(["invoice for January", "holiday photos"], live()));
      expect(Array.from(a ?? [])).not.toEqual(Array.from(b ?? []));
    },
  ),
  check("an aborted signal is Cancelled (guards embedding continuing after cancel)", async (e) => {
    cancelled(await e.embed(["x"], aborted()));
  }),
];

export const llmProviderChecks: readonly Check<LlmProvider>[] = [
  check("complete returns text (guards an empty or non-string answer)", async (llm) => {
    const text = unwrap(await llm.complete({ prompt: "Say hi", maxTokens: 8 }, live()));
    expect(typeof text).toBe("string");
  }),
  check(
    "an aborted signal is Cancelled (guards generation continuing after cancel)",
    async (llm) => {
      cancelled(await llm.complete({ prompt: "x" }, aborted()));
    },
  ),
];

const yesNo = z.object({ answer: z.enum(["yes", "no"]) });

/**
 * The harness answers `{"answer":"yes"}` to the prompt below (a fake queues it; a real model is asked for it).
 */
export const JSON_CONTRACT_PROMPT =
  'Is the sky blue? Answer with JSON: {"answer":"yes"} or {"answer":"no"}.';

export const jsonLlmProviderChecks: readonly Check<JsonLlmProvider>[] = [
  check("completeJson returns a value the schema accepts (guards unparsed output)", async (llm) => {
    const out = unwrap(
      await llm.completeJson({ prompt: JSON_CONTRACT_PROMPT, schema: yesNo }, live()),
    );
    expect(out).toEqual({ answer: "yes" });
  }),
  check(
    "an answer the schema refuses is invalid_output, not a guess (guards trusting model output)",
    async (llm) => {
      const never = yesNo.refine(() => false);
      const r = await llm.completeJson({ prompt: JSON_CONTRACT_PROMPT, schema: never }, live());
      expect(r.ok).toBe(false);
      expect(r.ok ? undefined : r.error.code).toBe("ai.invalid_output");
    },
  ),
  check(
    "completeJson with an aborted signal is Cancelled (guards generation after cancel)",
    async (llm) => {
      cancelled(await llm.completeJson({ prompt: JSON_CONTRACT_PROMPT, schema: yesNo }, aborted()));
    },
  ),
];

export const topicDiscovererChecks: readonly Check<TopicDiscoverer>[] = [
  check(
    "proposes named topics over the given messages only, and the same answer twice (guards a drifting or invented topic)",
    async (d) => {
      const messages = [1, 2, 3, 4].map((n) =>
        makeMessage(n, { from: n < 3 ? "a@shop.example.com" : "b@club.example.com" }),
      );
      const first = unwrap(await d.discover(messages, [], live()));
      expect(first.length).toBeGreaterThan(0);
      const ids = new Set<string>(messages.map((m) => m.id));
      for (const p of first) {
        expect(p.name.trim().length).toBeGreaterThan(0);
        for (const id of p.messageIds) expect(ids.has(id)).toBe(true);
      }
      expect(unwrap(await d.discover(messages, [], live()))).toEqual(first);
    },
  ),
  check("an empty batch has no topics (guards an error on nothing to do)", async (d) => {
    expect(unwrap(await d.discover([], [], live()))).toEqual([]);
  }),
  check("an aborted signal is Cancelled (guards discovery continuing after cancel)", async (d) => {
    cancelled(await d.discover([makeMessage(1)], [], aborted()));
  }),
];

export const classifierContract = (make: () => Classifier | Promise<Classifier>) =>
  registerContract("Classifier contract", classifierChecks, make);
export const embedderContract = (make: () => Embedder | Promise<Embedder>) =>
  registerContract("Embedder contract", embedderChecks, make);
export const llmProviderContract = (make: () => LlmProvider | Promise<LlmProvider>) =>
  registerContract("LlmProvider contract", llmProviderChecks, make);
export const jsonLlmProviderContract = (make: () => JsonLlmProvider | Promise<JsonLlmProvider>) =>
  registerContract("JsonLlmProvider contract", jsonLlmProviderChecks, make);
export const topicDiscovererContract = (make: () => TopicDiscoverer | Promise<TopicDiscoverer>) =>
  registerContract("TopicDiscoverer contract", topicDiscovererChecks, make);

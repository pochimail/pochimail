import { Cancelled } from "@pochimail/kernel/errors";
import { err, ok } from "@pochimail/kernel/result";
import { createFaults, type Faults } from "@pochimail/kernel/testing/faults";
import { AiInvalidOutput, AiUnavailable } from "../errors.ts";
import type { Category } from "../model/category.ts";
import type { AiError, Classification, Classifier, Embedder } from "../ports/classifier.ts";
import type { JsonLlmProvider } from "../ports/json-llm.ts";

export interface FakeAiControls {
  readonly faults: Faults<AiError>;
  /** Shorthand for `faults.failWith(new AiUnavailable())`: the model is missing or crashed. */
  makeUnavailable(): void;
}

function controls(): FakeAiControls {
  const faults = createFaults<AiError>();
  return { faults, makeUnavailable: () => faults.failWith(new AiUnavailable()) };
}

export interface FakeClassifier extends Classifier, FakeAiControls {}

/** Deterministic rules, no model: list-unsubscribe mail is a newsletter, the rest is people. */
export function createFakeClassifier(): FakeClassifier {
  const c = controls();
  return {
    ...c,
    async classify(messages, signal) {
      if (signal.aborted) return err(new Cancelled());
      const failure = c.faults.take();
      if (failure) return err(failure);
      return ok(
        messages.map((m): Classification => {
          const category: Category = m.hasListUnsubscribe ? "newsletters" : "people";
          return {
            messageId: m.id,
            category,
            confidence: 0.9,
            reasons: [`fake rule: ${category}`],
          };
        }),
      );
    },
  };
}

export interface FakeEmbedder extends Embedder, FakeAiControls {}

/** Same text, same vector; different text, different vector. */
export function createFakeEmbedder(dimensions = 8): FakeEmbedder {
  const c = controls();
  const vector = (text: string) => {
    const v = new Float32Array(dimensions);
    for (let i = 0; i < text.length; i++) {
      const slot = i % dimensions;
      v[slot] = (v[slot] ?? 0) + (text.charCodeAt(i) % 31) / 31;
    }
    return v;
  };
  return {
    ...c,
    dimensions,
    async embed(texts, signal) {
      if (signal.aborted) return err(new Cancelled());
      const failure = c.faults.take();
      if (failure) return err(failure);
      return ok(texts.map(vector));
    },
  };
}

export interface FakeLlmProvider extends JsonLlmProvider, FakeAiControls {
  /** Queue the next replies; once empty, `complete` echoes the prompt and `completeJson` is `AiInvalidOutput`. */
  reply(...texts: string[]): void;
  /** Every prompt received, in order. */
  prompts(): readonly string[];
}

const parseJson = (text: string | undefined): unknown => {
  try {
    return text === undefined ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
};

export function createFakeLlmProvider(): FakeLlmProvider {
  const c = controls();
  const replies: string[] = [];
  const prompts: string[] = [];
  return {
    ...c,
    reply: (...texts) => void replies.push(...texts),
    prompts: () => prompts.slice(),
    async complete(request, signal) {
      if (signal.aborted) return err(new Cancelled());
      const failure = c.faults.take();
      if (failure) return err(failure);
      prompts.push(request.prompt);
      return ok(replies.shift() ?? `echo: ${request.prompt}`);
    },
    async completeJson(request, signal) {
      if (signal.aborted) return err(new Cancelled());
      const failure = c.faults.take();
      if (failure) return err(failure);
      prompts.push(request.prompt);
      const parsed = request.schema.safeParse(parseJson(replies.shift()));
      return parsed.success ? ok(parsed.data) : err(new AiInvalidOutput());
    },
  };
}

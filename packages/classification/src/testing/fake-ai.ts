import { Cancelled } from "@pochimail/kernel/errors";
import type { MessageId } from "@pochimail/kernel/ids";
import { err, ok } from "@pochimail/kernel/result";
import { createFaults, type Faults } from "@pochimail/kernel/testing/faults";
import { AiUnavailable } from "../errors.ts";
import type { EmailType } from "../model/email-type.ts";
import type {
  AiError,
  Classification,
  Classifier,
  Embedder,
  LlmProvider,
} from "../ports/classifier.ts";
import type { TopicDiscoverer, TopicProposal } from "../ports/topic-discoverer.ts";

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

/** Deterministic rules, no model: list-unsubscribe mail is a newsletter, the rest is personal. */
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
          const category: EmailType = m.hasListUnsubscribe ? "newsletter" : "personal";
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

export interface FakeTopicDiscoverer extends TopicDiscoverer, FakeAiControls {}

/** Senders' domains that wrote at least this many emails become a topic. */
const FAKE_TOPIC_MIN_MESSAGES = 2;

/**
 * Deterministic, no model: emails from the same sender domain form a topic named after the
 * domain's first label ("Shop" for shop.example.com). A known topic of the same name is reused
 * verbatim, which is what makes a second scan find the same topics.
 */
export function createFakeTopicDiscoverer(): FakeTopicDiscoverer {
  const c = controls();
  return {
    ...c,
    async discover(messages, known, signal) {
      if (signal.aborted) return err(new Cancelled());
      const failure = c.faults.take();
      if (failure) return err(failure);
      const byDomain = new Map<string, MessageId[]>();
      for (const m of messages) {
        const label = m.from.split("@")[1]?.split(".")[0];
        if (label) byDomain.set(label, [...(byDomain.get(label) ?? []), m.id]);
      }
      return ok(
        [...byDomain]
          .filter(([, ids]) => ids.length >= FAKE_TOPIC_MIN_MESSAGES)
          .map(([label, ids]): TopicProposal => {
            const plain = label.charAt(0).toUpperCase() + label.slice(1);
            const name = known.find((t) => t.name.toLowerCase() === plain.toLowerCase())?.name;
            return { name: name ?? plain, messageIds: ids.sort() };
          })
          .sort((a, b) => (a.name < b.name ? -1 : 1)),
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

export interface FakeLlmProvider extends LlmProvider, FakeAiControls {
  /** Queue the next replies; once empty, `complete` echoes the prompt. */
  reply(...texts: string[]): void;
  /** Every prompt received, in order. */
  prompts(): readonly string[];
}

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
  };
}

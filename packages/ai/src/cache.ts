import { createHash } from "node:crypto";
import type { Classification, Classifier } from "@pochimail/classification/ports/classifier";
import { ok } from "@pochimail/kernel/result";

/** Distinct mail contents kept per model host process; the oldest answer leaves first. */
export const DEFAULT_CACHE_ENTRIES = 50_000;

type Answer = Omit<Classification, "messageId">;

/** The minimum input a classifier reads; ids, dates and recipients never change the answer. */
interface Content {
  readonly from: string;
  readonly subject: string;
  readonly snippet: string;
  readonly hasListUnsubscribe: boolean;
}

// PRIVATE MAIL DATA: the key is a hash of short mail text, so it can be guessed (ADR 0014). It lives in memory only.
const contentHash = (m: Content): string =>
  createHash("sha256")
    .update(JSON.stringify([m.from, m.subject, m.snippet, m.hasListUnsubscribe]))
    .digest("hex");

export interface CachingClassifier extends Classifier {
  /** Forgets every answer, for the moments private mail data must leave memory (account removal, lock). */
  clear(): void;
}

/**
 * Runs the inner classifier once per distinct content: a template seen twice, a re-scan or a retry
 * is answered from memory. The cache is dropped with the process and never written anywhere.
 * A message the inner classifier gave no answer for, and any failure, is not remembered.
 */
export const createCachingClassifier = (
  inner: Classifier,
  maxEntries: number = DEFAULT_CACHE_ENTRIES,
): CachingClassifier => {
  const answers = new Map<string, Answer>();
  const remember = (key: string, answer: Answer): void => {
    answers.delete(key);
    answers.set(key, answer);
    for (const oldest of answers.keys()) {
      if (answers.size <= maxEntries) break;
      answers.delete(oldest);
    }
  };

  return {
    clear: () => answers.clear(),
    async classify(messages, signal) {
      const keys = messages.map(contentHash);
      const known = new Map<string, Answer>();
      const missing = new Map<string, (typeof messages)[number]>();
      messages.forEach((message, i) => {
        const key = keys[i] as string;
        const hit = answers.get(key);
        if (hit) known.set(key, hit);
        else if (!missing.has(key)) missing.set(key, message);
      });

      if (missing.size > 0) {
        const done = await inner.classify([...missing.values()], signal);
        if (!done.ok) return done;
        const byId = new Map(done.value.map((c) => [c.messageId, c] as const));
        for (const [key, message] of missing) {
          const found = byId.get(message.id);
          if (!found) continue;
          const { messageId: _messageId, ...answer } = found;
          known.set(key, answer);
          remember(key, answer);
        }
      }

      return ok(
        messages.flatMap((message, i): Classification[] => {
          const answer = known.get(keys[i] as string);
          return answer ? [{ ...answer, messageId: message.id }] : [];
        }),
      );
    },
  };
};

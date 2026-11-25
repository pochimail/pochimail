import { AiUnavailable } from "@pochimail/classification/errors";
import type { Classifier } from "@pochimail/classification/ports/classifier";
import { createFakeClassifier } from "@pochimail/classification/testing/fake-ai";
import { makeMessage } from "@pochimail/classification/testing/samples";
import { createCancelSource } from "@pochimail/kernel/common";
import { unwrap } from "@pochimail/kernel/result";
import { describe, expect, it } from "vitest";
import { createCachingClassifier } from "./cache.ts";

const signal = createCancelSource().signal;

/** The fake engine, counting how many messages it was really asked to infer. */
const countingEngine = () => {
  const engine = createFakeClassifier();
  let inferred = 0;
  const classifier: Classifier = {
    classify(messages, s) {
      inferred += messages.length;
      return engine.classify(messages, s);
    },
  };
  return { classifier, engine, inferred: () => inferred };
};

/** `count` messages of `templates` distinct contents: the same template twice differs only by id, thread and date. */
const mailbox = (count: number, templates: number) =>
  Array.from({ length: count }, (_, n) =>
    makeMessage(n, {
      from: `sender${n % templates}@example.com`,
      subject: `Template ${n % templates}`,
      snippet: `Body ${n % templates}`,
      hasListUnsubscribe: n % templates === 0,
    }),
  );

describe("createCachingClassifier", () => {
  it("scanning the same mailbox twice infers once per distinct content (guards re-scans and repeated templates paying for inference again)", async () => {
    const { classifier, inferred } = countingEngine();
    const cached = createCachingClassifier(classifier);
    const messages = mailbox(30, 3);

    const first = unwrap(await cached.classify(messages, signal));
    const second = unwrap(await cached.classify(messages, signal));

    expect(inferred()).toBe(3);
    expect(second).toEqual(first);
    expect(first.map((c) => c.messageId)).toEqual(messages.map((m) => m.id));
  });

  it("answers each message under its own id (guards a cached answer leaking another message's id)", async () => {
    const cached = createCachingClassifier(createFakeClassifier());
    const messages = mailbox(2, 1);
    await cached.classify(messages.slice(0, 1), signal);

    const answered = unwrap(await cached.classify(messages.slice(1), signal));

    expect(answered.map((c) => c.messageId)).toEqual(messages.slice(1).map((m) => m.id));
  });

  it("does not remember a failure (guards a retry after the host returns staying stuck)", async () => {
    const { classifier, engine, inferred } = countingEngine();
    const cached = createCachingClassifier(classifier);
    const messages = mailbox(4, 2);
    engine.faults.failWith(new AiUnavailable(), { times: 1 });

    const failed = await cached.classify(messages, signal);
    const retried = unwrap(await cached.classify(messages, signal));

    expect(failed.ok).toBe(false);
    expect(retried).toHaveLength(4);
    expect(inferred()).toBe(4);
  });

  it("forgets the oldest content past its bound (guards the cache growing without limit)", async () => {
    const { classifier, inferred } = countingEngine();
    const cached = createCachingClassifier(classifier, 2);
    const messages = mailbox(3, 3);

    await cached.classify(messages, signal);
    await cached.classify(messages.slice(0, 1), signal);
    await cached.classify(messages.slice(2), signal);

    expect(inferred()).toBe(4);
  });
});

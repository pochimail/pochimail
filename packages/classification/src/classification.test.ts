// Guards: a decision stored without its reason, a signal that churns or leaks a body, a lost or duplicated event, and a classifier that answers off-contract.
import { unwrap } from "@pochimail/kernel/result";
import { describe, expect, it } from "vitest";
import { AiUnavailable } from "./errors.ts";
import type { Category } from "./model/category.ts";
import { DEFAULT_SIGNAL_SETTINGS, signalSettingsSchema } from "./model/signal-settings.ts";
import { type RuleInput, signalRules, UNSURE_CONFIDENCE } from "./policies/signal-rules.ts";
import {
  classifierContract,
  embedderContract,
  llmProviderContract,
} from "./testing/ai-contract.ts";
import { derivedContract } from "./testing/derived-contract.ts";
import {
  createFakeClassifier,
  createFakeEmbedder,
  createFakeLlmProvider,
} from "./testing/fake-ai.ts";
import { createGroundTruthClassifier } from "./testing/ground-truth-classifier.ts";
import { createInMemoryClassification } from "./testing/in-memory-classification.ts";
import { ACCOUNT_1, live, WS_A } from "./testing/samples.ts";
import { signalRepositoryContract } from "./testing/signal-repository-contract.ts";
import { signalsContract } from "./testing/signals-contract.ts";
import { signalsSafetyContract } from "./testing/signals-safety-contract.ts";
import { ClassifyBatch } from "./use-cases/classify-batch.ts";
import { CountCategories } from "./use-cases/count-categories.ts";

const fakeClock = () => {
  let at = Date.parse("2026-01-01T00:00:00.000Z");
  return {
    now: () => new Date(at),
    advance: (ms: number) => {
      at += ms;
    },
  };
};

derivedContract(() => createInMemoryClassification());
signalRepositoryContract(() => createInMemoryClassification());
const signalsHarness = () => {
  const labels = new Map<string, Category>();
  return {
    ...createInMemoryClassification(),
    clock: fakeClock(),
    classifier: createGroundTruthClassifier(labels),
    labels,
  };
};
signalsContract(signalsHarness);
signalsSafetyContract(signalsHarness);
classifierContract(createFakeClassifier);
embedderContract(() => createFakeEmbedder(8));
llmProviderContract(createFakeLlmProvider);

describe("classification", () => {
  it("the fake classifier reports AiUnavailable on demand (guards untested model-missing handling)", async () => {
    const classifier = createFakeClassifier();
    classifier.makeUnavailable();
    const r = await classifier.classify([], live());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("ai.unavailable");
  });

  it("counts every category, zero when empty (guards a sidebar missing a category)", async () => {
    const c = createInMemoryClassification();
    await c.seed({ 1: { category: "people" }, 2: { category: "people" }, 3: {} });
    const counts = unwrap(await new CountCategories({ uow: c.uow }).execute(WS_A, [ACCOUNT_1]));
    expect(counts.people).toBe(2);
    expect(counts.notifications).toBe(1);
    expect(counts.promotions).toBe(0);
  });

  it("an unavailable classifier fails with AiUnavailable and stores nothing (guards a half-classified batch)", async () => {
    const c = createInMemoryClassification();
    await c.seed({ 1: {} });
    const classifier = createFakeClassifier();
    classifier.makeUnavailable();
    const r = await new ClassifyBatch({
      uow: c.uow,
      classifier,
      clock: fakeClock(),
    }).execute({ workspaceId: WS_A, messageIds: ["msg-1" as never] }, live());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBeInstanceOf(AiUnavailable);
    expect(c.committedEvents()).toEqual([]);
  });
});

describe("signal rules", () => {
  const input: RuleInput = {
    from: "alice@example.com",
    receivedAt: "2026-01-01T00:00:00.000Z",
    opened: true,
    category: "people",
    confidence: 0.9,
    ownerAddress: "owner@example.com",
    now: new Date("2026-01-02T00:00:00.000Z"),
    lastInThread: true,
    important: false,
    hasListUnsubscribe: false,
    attachmentCount: 0,
    settings: DEFAULT_SIGNAL_SETTINGS,
  };

  it("an unreadable sender or date still protects at reduced confidence (guards a silent rule on missing facts, ADR 0012)", () => {
    for (const unreadable of [{ from: "" }, { receivedAt: "not a date" }]) {
      const hit = signalRules({ ...input, ...unreadable }).find((h) => h.kind === "needs-reply");
      expect(hit?.confidence).toBe(UNSURE_CONFIDENCE);
    }
    expect(signalRules(input).find((h) => h.kind === "needs-reply")?.confidence).toBeGreaterThan(
      UNSURE_CONFIDENCE,
    );
  });

  it("settings reject a waiting age beyond the recent window (guards a window that can never match)", () => {
    expect(signalSettingsSchema.safeParse({ recentDays: 3, waitingAfterDays: 7 }).success).toBe(
      false,
    );
    expect(signalSettingsSchema.safeParse({ recentDays: 0, waitingAfterDays: 0 }).success).toBe(
      false,
    );
  });
});

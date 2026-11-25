// Guards: a protected sender proposed for cleanup, a digest that re-reports old mail, an Overview figure that drifts, and a lost or phantom event.
import { unwrap } from "@pochimail/kernel/result";
import { describe, expect, it } from "vitest";
import { createSuggestion } from "./model/suggestion.ts";
import { digestContract } from "./testing/digest-contract.ts";
import { digestStateContract } from "./testing/digest-state-contract.ts";
import { createInMemoryCleanup } from "./testing/in-memory-cleanup.ts";
import { createInMemoryDigestTally } from "./testing/in-memory-digest-tally.ts";
import { ACCOUNT_1, makeSuggestion, WS_A } from "./testing/samples.ts";
import { suggestionRepositoryContract } from "./testing/suggestion-repository-contract.ts";
import { suggestionsContract } from "./testing/suggestions-contract.ts";
import { GetDigestStatus } from "./use-cases/get-digest-status.ts";
import { GetOverview } from "./use-cases/get-overview.ts";
import { RecordDigestReady } from "./use-cases/record-digest-ready.ts";

const fakeClock = () => {
  let at = Date.parse("2026-01-01T00:00:00.000Z");
  return {
    now: () => new Date(at),
    advance: (ms: number) => {
      at += ms;
    },
  };
};

digestStateContract(() => createInMemoryCleanup());
suggestionRepositoryContract(() => createInMemoryCleanup());
suggestionsContract(() => ({
  ...createInMemoryCleanup(),
  clock: fakeClock(),
  protectedLabels: ["people"],
}));
digestContract(() => ({ ...createInMemoryCleanup(), clock: fakeClock() }));

describe("Suggestion invariants", () => {
  it("rejects a suggestion without reasons (UI could not explain it)", () => {
    expect(createSuggestion({ ...makeSuggestion(), reasons: [] }).ok).toBe(false);
  });
  it.each([-0.01, 1.01, Number.NaN])(
    "rejects confidence %s outside 0..1 (autopilot threshold bypass)",
    (confidence) => {
      expect(createSuggestion({ ...makeSuggestion(), confidence }).ok).toBe(false);
    },
  );
  it("accepts a valid suggestion", () => {
    expect(createSuggestion(makeSuggestion()).ok).toBe(true);
  });
});

describe("GetOverview", () => {
  it("counts what needs the person and what could be cleaned, largest first (guards a drifting headline figure)", async () => {
    const cleanup = createInMemoryCleanup();
    await cleanup.seed({
      1: { category: "newsletters", signals: ["needs-reply"] },
      2: { category: "promotions" },
      3: { category: "promotions", signals: ["time-sensitive"] },
      4: { category: "people" },
    });
    const overview = unwrap(
      await new GetOverview({ uow: cleanup.uow, clock: fakeClock() }).execute(WS_A, ACCOUNT_1),
    );
    expect(overview.scanned).toBe(4);
    expect([overview.waiting, overview.deadlines, overview.toReview]).toEqual([1, 1, 2]);
    expect(overview.cleanable).toEqual([
      { category: "promotions", count: 2 },
      { category: "newsletters", count: 1 },
    ]);
  });

  // Guards: a guess inflating "to review", and one email counted twice in the headline (ADR 0012).
  it("counts only sure signals and counts an email once across waiting and important", async () => {
    const cleanup = createInMemoryCleanup();
    await cleanup.seed({
      1: { category: "people", signals: ["needs-reply"] },
      2: { category: "people", signals: ["needs-reply", "important-sender"] },
      3: { category: "people", signals: ["important-sender", "time-sensitive"] },
      4: { category: "people", unsureSignals: ["needs-reply", "time-sensitive", "has-document"] },
    });
    const overview = unwrap(
      await new GetOverview({ uow: cleanup.uow, clock: fakeClock() }).execute(WS_A, ACCOUNT_1),
    );
    expect([overview.waiting, overview.deadlines, overview.important]).toEqual([1, 1, 2]);
    expect(overview.toReview).toBe(3);
  });

  // Guards: Overview figures counting unknown sizes or attachment facts, or inventing action totals (#114).
  it("sums the stored attachment and size facts, leaving unknown rows out of the sums", async () => {
    const cleanup = createInMemoryCleanup();
    await cleanup.seed({
      1: { message: { size: 2_000_000_000, savedCount: 2, savedSize: 500_000_000 } },
      2: { message: { size: 1_000_000_000, savedCount: 1, savedSize: 700_000_000 } },
      3: {}, // stored before the provider reported sizes: unknown adds nothing
    });
    const overview = unwrap(
      await new GetOverview({ uow: cleanup.uow, clock: fakeClock() }).execute(WS_A, ACCOUNT_1),
    );
    // The fake holds no action log, so the action-derived figures are truly 0 here;
    // the repositories contract exercises them on the real stores.
    expect(overview.figures).toEqual({
      archived: 0,
      savedCount: 3,
      savedSize: 1_200_000_000,
      deletableSize: 0,
      unsubscribed: 0,
      totalSize: 3_000_000_000,
    });
  });
});

describe("digest status", () => {
  it("counts a delivered event once (guards double counting on at-least-once delivery)", () => {
    const tally = createInMemoryDigestTally();
    const record = new RecordDigestReady({ tally });
    const event = {
      id: "digest:acc-1:since",
      type: "DigestReady" as const,
      version: 1 as const,
      workspaceId: WS_A,
      occurredAt: "2026-01-01T00:00:00.000Z",
      payload: { itemCount: 3 },
    };
    record.execute(event);
    record.execute(event);
    expect(new GetDigestStatus({ tally }).execute()).toEqual({ ready: true, itemCount: 3 });
  });
});

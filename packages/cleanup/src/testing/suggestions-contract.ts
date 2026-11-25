import type { Clock } from "@pochimail/kernel/clock";
import { UNSURE_BELOW } from "@pochimail/kernel/confidence";
import { ok, unwrap } from "@pochimail/kernel/result";
import { type Check, check, registerContract } from "@pochimail/kernel/testing/contract";
import { expect } from "vitest";
import type { CleanupUnitOfWork } from "../ports/unit-of-work.ts";
import { ProposeSuggestions } from "../use-cases/propose-suggestions.ts";
import { ACCOUNT_1, live, type Seeder, type SeedRow, WS_A } from "./samples.ts";

/** What the suggestion suite needs; in-memory here, SQLite in the db package. */
export interface SuggestionsHarness extends Seeder {
  readonly uow: CleanupUnitOfWork;
  readonly clock: Clock;
  /** The labels the adapter under test treats as protected; the contract seeds "people". */
  readonly protectedLabels: readonly string[];
}

const unopenedPromos = (extra: Partial<NonNullable<SeedRow["message"]>> = {}) =>
  Object.fromEntries(
    [1, 2, 3].map((n) => [
      n,
      {
        category: "promotions",
        message: { from: "promo@example.com", hasListUnsubscribe: true, ...extra },
        reason: "Weekly promo, never opened",
        confidence: 0.95,
      } satisfies SeedRow,
    ]),
  );

const suggestionsFor = async (h: SuggestionsHarness) =>
  unwrap(
    await new ProposeSuggestions({
      uow: h.uow,
      clock: h.clock,
      protectedLabels: h.protectedLabels,
    }).execute({ workspaceId: WS_A, accountId: ACCOUNT_1 }, live()),
  );

export const suggestionsChecks: readonly Check<SuggestionsHarness>[] = [
  check(
    "a sender is proposed for unsubscribe with the recorded reason and confidence (guards a suggestion the UI cannot explain)",
    async (h) => {
      await h.seed(unopenedPromos());
      const made = await suggestionsFor(h);
      expect(made).toHaveLength(1);
      const [s] = made;
      expect(s?.recommendation.kind).toBe("unsubscribe");
      expect(s?.reasons.join(" ")).toContain("Weekly promo, never opened");
      expect(s?.confidence).toBe(0.95);
      expect(s?.state).toBe("pending");
      expect(await h.eventTypes()).toEqual(["SuggestionCreated"]);
    },
  ),
  check(
    "no suggestion touches People mail, even from a sender that also sends promotions, and none is a delete (guards the brief §2 invariants)",
    async (h) => {
      const people = Object.fromEntries(
        [1, 2, 3].map((n) => [
          n,
          {
            category: "people",
            message: { from: "friend@example.com", hasListUnsubscribe: true },
          } satisfies SeedRow,
        ]),
      );
      const shop = { from: "shop@example.com", hasListUnsubscribe: true };
      await h.seed({
        ...people,
        4: { category: "promotions", message: shop },
        5: { category: "promotions", message: shop },
        6: { category: "people", message: shop },
      });
      expect(await suggestionsFor(h)).toEqual([]);
      const all = unwrap(await h.uow.reads.suggestions.listPending(WS_A, { limit: 100 }));
      for (const s of all.items)
        expect(["archive", "unsubscribe"]).toContain(s.recommendation.kind);
    },
  ),
  check(
    "a sender whose mail is unsure is never proposed, whatever label it was filed under (guards ADR 0012: unsure means protected)",
    async (h) => {
      await h.seed(
        Object.fromEntries(
          Object.entries(unopenedPromos()).map(([n, row]) => [
            n,
            { ...row, confidence: UNSURE_BELOW - 0.01 },
          ]),
        ),
      );
      expect(await suggestionsFor(h)).toEqual([]);
    },
  ),
  check(
    "senders you open are not proposed and re-running neither duplicates nor reopens a decided suggestion (guards nagging)",
    async (h) => {
      const read = (n: number): [number, SeedRow] => [
        n,
        { category: "newsletters", message: { from: "read@example.com", opened: true } },
      ];
      await h.seed({ ...unopenedPromos(), ...Object.fromEntries([4, 5, 6].map(read)) });
      const first = await suggestionsFor(h);
      expect(first).toHaveLength(1);
      const [created] = first;
      if (!created) throw new Error("expected a suggestion");
      await h.uow.run(async (tx) => {
        await tx.repositories.suggestions.save({ ...created, state: "dismissed" });
        return ok(undefined);
      });
      expect(await suggestionsFor(h)).toEqual([]);
      expect(unwrap(await h.uow.reads.suggestions.get(WS_A, created.id)).state).toBe("dismissed");
    },
  ),
];

export function suggestionsContract(
  make: () => SuggestionsHarness | Promise<SuggestionsHarness>,
): void {
  registerContract("Suggestions", suggestionsChecks, make);
}

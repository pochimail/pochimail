import type { Clock } from "@pochimail/kernel/clock";
import { UNSURE_BELOW } from "@pochimail/kernel/confidence";
import { ok, unwrap } from "@pochimail/kernel/result";
import { type Check, check, registerContract } from "@pochimail/kernel/testing/contract";
import { expect } from "vitest";
import { CLEANABLE_LABELS } from "../policies/labels.ts";
import type { CleanupUnitOfWork } from "../ports/unit-of-work.ts";
import { GetOverview } from "../use-cases/get-overview.ts";
import { ProposeSuggestions } from "../use-cases/propose-suggestions.ts";
import { ACCOUNT_1, idOf, live, type Seeder, type SeedRow, WS_A } from "./samples.ts";

/** What the suggestion suite needs; in-memory here, SQLite in the db package. */
export interface SuggestionsHarness extends Seeder {
  readonly uow: CleanupUnitOfWork;
  readonly clock: Clock;
}

// Three unopened emails of one sender. `attachments` is what the provider reported: none (0) by
// default, since an unknown count (null) protects the email (ADR 0012).
const unopenedPromos = (
  extra: Partial<NonNullable<SeedRow["message"]>> = {},
  type = "promotion",
  signals: Pick<SeedRow, "signals" | "unsureSignals"> = {},
  attachments: number | null = 0,
  first = 1,
) =>
  Object.fromEntries(
    [first, first + 1, first + 2].map((n) => [
      n,
      {
        category: type,
        message: {
          from: "promo@example.com",
          hasListUnsubscribe: true,
          ...(attachments === null ? {} : { savedCount: attachments }),
          ...extra,
        },
        reason: "Weekly promo, never opened",
        confidence: 0.95,
        ...signals,
      } satisfies SeedRow,
    ]),
  );

const suggestionsFor = async (h: SuggestionsHarness) =>
  unwrap(
    await new ProposeSuggestions({ uow: h.uow, clock: h.clock }).execute(
      { workspaceId: WS_A, accountId: ACCOUNT_1 },
      live(),
    ),
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
    "a suggestion is keyed by the sender hash and carries no address (guards an address persisted in a suggestion id, ADR 0014)",
    async (h) => {
      await h.seed(unopenedPromos());
      const [s] = await suggestionsFor(h);
      expect(s?.id).toMatch(/^sug:acc-1:[0-9a-f]{16,}:unsubscribe$/);
      expect(JSON.stringify(s)).not.toContain("promo@example.com");
    },
  ),
  check(
    "protection reads signals only: every cleanable type is proposed without a protecting signal and never with one (guards a protection tied to a type name)",
    async (h) => {
      for (const [i, type] of CLEANABLE_LABELS.entries()) {
        const sender = (n: number) => ({ from: `sender-${i}-${n}@example.com` });
        await h.seed({
          ...unopenedPromos(sender(0), type, {}, 0, 100 * i + 1),
          ...unopenedPromos(sender(1), type, { signals: ["has-document"] }, 2, 100 * i + 11),
          ...unopenedPromos(
            sender(2),
            type,
            { unsureSignals: ["has-document"] },
            null,
            100 * i + 21,
          ),
        });
        const made = await suggestionsFor(h);
        const first = 100 * i + 1;
        expect(made.map((s) => [...s.recommendation.messageIds].sort())).toEqual([
          [first, first + 1, first + 2].map(idOf).sort(),
        ]);
      }
    },
  ),
  check(
    "no suggestion is a delete or touches personal or transactional mail, even from a sender that also sends promotional mail (guards the brief §2 invariants)",
    async (h) => {
      const shop = { from: "shop@example.com", hasListUnsubscribe: true, savedCount: 0 };
      await h.seed({
        ...unopenedPromos({}, "personal"),
        ...Object.fromEntries(
          [4, 5, 6].map((n) => [n, { category: "transactional", message: shop } satisfies SeedRow]),
        ),
        7: { category: "promotion", message: shop },
        8: { category: "promotion", message: shop },
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
    "a sender with a message that has no decision is not proposed (guards suggesting mail the classifier has not judged)",
    async (h) => {
      const promos = unopenedPromos();
      await h.seed({ ...promos, 3: { ...promos[3], undecided: true } });
      expect(await suggestionsFor(h)).toEqual([]);
    },
  ),
  check(
    "the Overview counts as cleanable only the mail that suggestions propose, never unsure or undecided mail (guards ADR 0012)",
    async (h) => {
      const doubtful = (from: string, over: Partial<SeedRow> = {}): SeedRow => ({
        category: "promotion",
        message: { from, hasListUnsubscribe: true },
        confidence: UNSURE_BELOW - 0.01,
        ...over,
      });
      await h.seed({
        ...unopenedPromos(),
        4: doubtful("unsure@example.com"),
        5: doubtful("unsure@example.com"),
        6: doubtful("undecided@example.com", { undecided: true }),
      });
      const proposed = await suggestionsFor(h);
      const overview = unwrap(await new GetOverview({ uow: h.uow, clock: h.clock }).execute(WS_A));
      expect(proposed.flatMap((s) => s.recommendation.messageIds)).toHaveLength(3);
      expect(overview.cleanable).toEqual([{ category: "promotion", count: 3 }]);
    },
  ),
  check(
    "senders you open are not proposed and re-running neither duplicates nor reopens a decided suggestion (guards nagging)",
    async (h) => {
      const read = (n: number): [number, SeedRow] => [
        n,
        {
          category: "newsletter",
          message: { from: "read@example.com", opened: true, savedCount: 0 },
        },
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

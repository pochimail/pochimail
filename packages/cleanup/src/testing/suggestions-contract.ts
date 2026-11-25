import type { Clock } from "@pochimail/kernel/clock";
import { UNSURE_BELOW } from "@pochimail/kernel/confidence";
import { ok, unwrap } from "@pochimail/kernel/result";
import { type Check, check, registerContract } from "@pochimail/kernel/testing/contract";
import { expect } from "vitest";
import { CLEANABLE_LABELS } from "../policies/labels.ts";
import type { CleanupUnitOfWork } from "../ports/unit-of-work.ts";
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

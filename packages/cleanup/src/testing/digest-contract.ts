import type { Clock } from "@pochimail/kernel/clock";
import { unwrap } from "@pochimail/kernel/result";
import { type Check, check, registerContract } from "@pochimail/kernel/testing/contract";
import { expect } from "vitest";
import type { CleanupUnitOfWork } from "../ports/unit-of-work.ts";
import { BuildDigest } from "../use-cases/build-digest.ts";
import { ACCOUNT_1, idOf, live, type Seeder, WS_A } from "./samples.ts";

/** What the digest suite needs; in-memory here, SQLite in the db package. */
export interface DigestHarness extends Seeder {
  readonly uow: CleanupUnitOfWork;
  readonly clock: Clock & { advance(ms: number): void };
}

const DAY = 86_400_000;

export const digestChecks: readonly Check<DigestHarness>[] = [
  check(
    "a digest after a second sync holds only mail new since the first and flags no unsure guess (guards re-reporting old mail and noisy attention)",
    async (h) => {
      const base = h.clock.now().getTime();
      const at = (ms: number) => new Date(base + ms).toISOString();
      await h.seed({
        1: { message: { receivedAt: at(-3_600_000) }, category: "newsletters" },
        2: { message: { receivedAt: at(-3_000_000) }, category: "people" },
        3: { message: { receivedAt: at(-2_000_000) }, category: "promotions" },
      });
      const build = new BuildDigest({ uow: h.uow, clock: h.clock });
      const first = unwrap(
        await build.execute({ workspaceId: WS_A, accountId: ACCOUNT_1, since: at(-DAY) }, live()),
      );
      expect(first.newMessageCount).toBe(3);

      h.clock.advance(3_600_000);
      await h.seed({
        4: {
          message: { receivedAt: at(1_800_000), from: "alice@example.com" },
          category: "people",
          signals: ["needs-reply"],
        },
        5: { message: { receivedAt: at(2_000_000) }, category: "promotions" },
        6: {
          message: { receivedAt: at(2_100_000), from: "bob@example.com" },
          category: "people",
          confidence: 0.3,
          unsureSignals: ["needs-reply"],
        },
      });
      const second = unwrap(
        await build.execute(
          { workspaceId: WS_A, accountId: ACCOUNT_1, since: first.generatedAt },
          live(),
        ),
      );
      expect(second.newMessageCount).toBe(3);
      expect(second.byCategory).toEqual({ people: 2, promotions: 1 });
      expect(second.attention).toEqual([{ messageId: idOf(4), kind: "needs-reply" }]);
      expect((await h.eventTypes()).filter((t) => t === "DigestReady")).toHaveLength(2);
    },
  ),
  check(
    "two consecutive digests with a sync between them: the second holds only mail new since the first, with no caller-supplied since (guards re-reporting old mail)",
    async (h) => {
      const base = h.clock.now().getTime();
      const at = (ms: number) => new Date(base + ms).toISOString();
      await h.seed({
        1: { message: { receivedAt: at(-3_000_000) }, category: "newsletters" },
        2: { message: { receivedAt: at(-2_000_000) }, category: "promotions" },
      });
      const build = new BuildDigest({ uow: h.uow, clock: h.clock });
      const request = { workspaceId: WS_A, accountId: ACCOUNT_1 };
      const first = unwrap(await build.execute(request, live()));
      expect(first.newMessageCount).toBe(2);

      h.clock.advance(3_600_000);
      await h.seed({ 3: { message: { receivedAt: at(1_800_000) }, category: "promotions" } });
      const second = unwrap(await build.execute(request, live()));
      expect(second.since).toBe(first.generatedAt);
      expect(second.newMessageCount).toBe(1);
      expect(second.byCategory).toEqual({ promotions: 1 });
    },
  ),
  check(
    "mail delivered late with an old date still appears in the next digest (guards a digest cursor keyed on the message date)",
    async (h) => {
      const base = h.clock.now().getTime();
      const at = (ms: number) => new Date(base + ms).toISOString();
      await h.seed({ 1: { message: { receivedAt: at(-3_000_000) }, category: "newsletters" } });
      const build = new BuildDigest({ uow: h.uow, clock: h.clock });
      const request = { workspaceId: WS_A, accountId: ACCOUNT_1 };
      expect(unwrap(await build.execute(request, live())).newMessageCount).toBe(1);

      h.clock.advance(3_600_000);
      await h.seed({ 2: { message: { receivedAt: at(-9_000_000) }, category: "promotions" } });
      const second = unwrap(await build.execute(request, live()));
      expect(second.newMessageCount).toBe(1);
      expect(second.byCategory).toEqual({ promotions: 1 });
      // A re-sync of the same mail is not new again.
      await h.seed({ 2: { message: { receivedAt: at(-9_000_000) }, category: "promotions" } });
      expect(unwrap(await build.execute(request, live())).newMessageCount).toBe(0);
    },
  ),
];

export function digestContract(make: () => DigestHarness | Promise<DigestHarness>): void {
  registerContract("Digest", digestChecks, make);
}

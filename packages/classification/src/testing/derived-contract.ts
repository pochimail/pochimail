import type { MessageId } from "@pochimail/kernel/ids";
import { ok, unwrap } from "@pochimail/kernel/result";
import { type Check, check, registerContract } from "@pochimail/kernel/testing/contract";
import { expect } from "vitest";
import type { DerivedMessage } from "../model/derived.ts";
import type { ClassificationUnitOfWork } from "../ports/unit-of-work.ts";
import { ACCOUNT_1, makeDerived, WS_A, WS_B } from "./samples.ts";

/** What a derived-data contract needs: any `ClassificationUnitOfWork`. */
export interface DerivedHarness {
  readonly uow: ClassificationUnitOfWork;
}

async function save(h: DerivedHarness, ...rows: DerivedMessage[]) {
  const r = await h.uow.run(async (tx) => {
    for (const row of rows) unwrap(await tx.repositories.derived.save(row));
    return ok(undefined);
  });
  expect(r.ok).toBe(true);
}

export const derivedChecks: readonly Check<DerivedHarness>[] = [
  check(
    "a decision keeps its reason, confidence, version and template hash across a round trip (guards a UI that cannot explain a decision)",
    async (h) => {
      const row = makeDerived(1, { templateHash: "tpl-1", embeddingRef: "emb-1" });
      await save(h, row);
      expect(await h.uow.reads.derived.get(WS_A, row.messageId)).toEqual(ok(row));
    },
  ),
  check(
    "saving again replaces the row and never returns another workspace's data (guards duplicates on re-classification and cross-workspace leaks)",
    async (h) => {
      await save(h, makeDerived(1), makeDerived(1, { category: "promotion", confidence: 0.5 }));
      const got = unwrap(await h.uow.reads.derived.get(WS_A, "msg-1" as MessageId));
      expect([got.category, got.confidence]).toEqual(["promotion", 0.5]);
      const listed = unwrap(await h.uow.reads.derived.list(WS_A, ACCOUNT_1, { limit: 10 }));
      expect(listed.items).toHaveLength(1);
      expect((await h.uow.reads.derived.get(WS_B, "msg-1" as MessageId)).ok).toBe(false);
      expect(unwrap(await h.uow.reads.derived.list(WS_B, ACCOUNT_1, { limit: 10 })).items).toEqual(
        [],
      );
    },
  ),
  check(
    "one read returns the rows of the asked messages only, leaves out a message with none and stays inside the workspace (guards a per-message read on every Overview load)",
    async (h) => {
      await save(h, makeDerived(1), makeDerived(2), makeDerived(3));
      const ids = ["msg-1", "msg-3", "msg-9"] as MessageId[];
      const got = unwrap(await h.uow.reads.derived.listForMessages(WS_A, ids));
      expect(got.map((d) => d.messageId).sort()).toEqual(["msg-1", "msg-3"]);
      expect(unwrap(await h.uow.reads.derived.listForMessages(WS_B, ids))).toEqual([]);
    },
  ),
];

export function derivedContract(make: () => DerivedHarness | Promise<DerivedHarness>): void {
  registerContract("Derived message data", derivedChecks, make);
}

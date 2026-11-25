import { makeDerived } from "@pochimail/classification/testing/samples";
import type { AccountId } from "@pochimail/kernel/ids";
import { unwrap } from "@pochimail/kernel/result";
import { type Check, check, registerContract } from "@pochimail/kernel/testing/contract";
import { expect } from "vitest";
import { ACCOUNT_1, makeIncomingMessage, WS_A } from "./fixtures.ts";
import { type UnitOfWorkHarness, writeThrough as write } from "./unit-of-work-contract.ts";

type H = UnitOfWorkHarness;

export const unclassifiedChecks: readonly Check<H>[] = [
  check(
    "listUnclassified returns only the account's messages with no derived decision, in id order, within the limit, and stops listing a message once it is classified (guards new mail that is never classified)",
    async (h) => {
      const other = "acc-2" as AccountId;
      const mail = [3, 1, 2, 4].map((n) => makeIncomingMessage(n));
      await write(h, (tx) =>
        tx.repositories.messages.upsertMany([
          ...mail,
          makeIncomingMessage(5, { accountId: other }),
        ]),
      );
      const ids = async (limit: number) =>
        unwrap(await h.uow.reads.messages.listUnclassified(WS_A, ACCOUNT_1, limit));
      expect(await ids(10)).toEqual(["msg-1", "msg-2", "msg-3", "msg-4"]);
      expect(await ids(2)).toEqual(["msg-1", "msg-2"]);
      expect(await ids(0)).toEqual([]);

      await write(h, (tx) => tx.repositories.derived.save(makeDerived(1)));
      expect(await ids(10)).toEqual(["msg-2", "msg-3", "msg-4"]);
      expect(unwrap(await h.uow.reads.messages.listUnclassified(WS_A, other, 10))).toEqual([
        "msg-5",
      ]);
    },
  ),
];

/** The read that finds stored mail with no classification yet, for any unit of work: in-memory and SQLite alike. */
export function unclassifiedContract(make: () => H | Promise<H>): void {
  registerContract("Unclassified messages contract", unclassifiedChecks, make);
}

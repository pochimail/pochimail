import type { AccountId, MessageId } from "@pochimail/kernel/ids";
import { unwrap } from "@pochimail/kernel/result";
import { type Check, check, registerContract } from "@pochimail/kernel/testing/contract";
import { expect } from "vitest";
import { ACCOUNT_1, makeActionLog, makeIncomingMessage, WS_A, WS_B } from "./fixtures.ts";
import { type UnitOfWorkHarness, writeThrough as write } from "./unit-of-work-contract.ts";

const figuresChecks: readonly Check<UnitOfWorkHarness>[] = [
  // Guards: Overview figures counting unknown rows, ignoring undo, or counting failed actions (#114).
  check(
    "figures aggregate stored facts and executed actions per account, and a re-sync keeps the archived marker",
    async (h) => {
      const other = "acc-2" as AccountId;
      const ids = (n: number[]) => n.map((i) => `msg-${i}` as MessageId);
      const unsub = (n: number, msg: number) =>
        makeActionLog(n, {
          command: { kind: "unsubscribe", messageIds: ids([msg]) },
          inverse: null,
          irreversible: true,
          irreversibleReason: "An unsubscribe request cannot be recalled",
        });
      await write(h, async (tx) => {
        await tx.repositories.messages.upsertMany([
          makeIncomingMessage(1, { size: 3_000, savedCount: 2, savedSize: 1_000 }),
          makeIncomingMessage(2, { size: 2_000 }), // attachment facts unknown
          makeIncomingMessage(3), // size unknown too: adds nothing
          makeIncomingMessage(4, { accountId: other, size: 500, savedCount: 1, savedSize: 200 }),
        ]);
        // msg-1 archived; msg-2 archived, then the undo ran unarchive: back in the inbox.
        await tx.repositories.actionLog.append(makeActionLog(1));
        await tx.repositories.actionLog.append(
          makeActionLog(2, {
            command: { kind: "archive", messageIds: ids([2]) },
            inverse: { kind: "unarchive", messageIds: ids([2]) },
          }),
        );
        await tx.repositories.actionLog.append(
          makeActionLog(3, {
            outcome: "undone",
            command: { kind: "unarchive", messageIds: ids([2]) },
            inverse: { kind: "archive", messageIds: ids([2]) },
          }),
        );
        // msg-1 trashed, untrashed, then trashed again with msg-2: the latest effect wins.
        await tx.repositories.actionLog.append(
          makeActionLog(4, {
            command: { kind: "trash", messageIds: ids([1]) },
            inverse: { kind: "untrash", messageIds: ids([1]) },
          }),
        );
        await tx.repositories.actionLog.append(
          makeActionLog(5, {
            command: { kind: "untrash", messageIds: ids([1]) },
            inverse: { kind: "trash", messageIds: ids([1]) },
          }),
        );
        await tx.repositories.actionLog.append(
          makeActionLog(6, {
            command: { kind: "trash", messageIds: ids([1, 2]) },
            inverse: { kind: "untrash", messageIds: ids([1, 2]) },
          }),
        );
        // A failed untrash and a refused archive changed nothing.
        await tx.repositories.actionLog.append(
          makeActionLog(7, {
            outcome: "failed",
            command: { kind: "untrash", messageIds: ids([1]) },
            inverse: null,
          }),
        );
        await tx.repositories.actionLog.append(
          makeActionLog(8, {
            outcome: "refused",
            command: { kind: "archive", messageIds: ids([3]) },
            inverse: null,
            denialReason: "protected-category",
          }),
        );
        // One applied unsubscribe per account; the failed one counts for nothing.
        await tx.repositories.actionLog.append(unsub(9, 4));
        await tx.repositories.actionLog.append(unsub(10, 1));
        await tx.repositories.actionLog.append(
          makeActionLog(11, {
            outcome: "failed",
            command: { kind: "unsubscribe", messageIds: ids([2]) },
            inverse: null,
          }),
        );
        // A re-sync of msg-1 must not overwrite the archived marker.
        await tx.repositories.messages.upsertMany([
          makeIncomingMessage(1, { opened: true, size: 3_000, savedCount: 2, savedSize: 1_000 }),
        ]);
      });
      const figures = unwrap(await h.uow.reads.mailboxFacts.figures(WS_A, [ACCOUNT_1, other]));
      expect([...figures].sort((a, b) => (a.accountId < b.accountId ? -1 : 1))).toEqual([
        {
          accountId: ACCOUNT_1,
          archived: 1,
          savedCount: 2,
          savedSize: 1_000,
          deletableSize: 5_000,
          unsubscribed: 1,
          totalSize: 5_000,
        },
        {
          accountId: other,
          archived: 0,
          savedCount: 1,
          savedSize: 200,
          deletableSize: 0,
          unsubscribed: 1,
          totalSize: 500,
        },
      ]);
      expect(unwrap(await h.uow.reads.mailboxFacts.figures(WS_A, []))).toEqual([]);
      expect(unwrap(await h.uow.reads.mailboxFacts.figures(WS_B, [ACCOUNT_1]))).toEqual([]);
      // An account without stored mail has no row, even with log entries.
      expect(unwrap(await h.uow.reads.mailboxFacts.figures(WS_A, ["acc-3" as AccountId]))).toEqual(
        [],
      );
    },
  ),
];

/** Read-model contract for the per-account Overview figures (#114), shared by both stores. */
export function figuresContract(make: () => UnitOfWorkHarness | Promise<UnitOfWorkHarness>): void {
  registerContract("Overview figures contract", figuresChecks, make);
}

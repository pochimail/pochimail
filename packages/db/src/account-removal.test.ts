import type { AccountId, MessageId } from "@pochimail/kernel/ids";
import { ok, unwrap } from "@pochimail/kernel/result";
import { createFakeClock } from "@pochimail/testing/fake-clock";
import { ACCOUNT_1, makeAccount, makeActionLog, WS_A } from "@pochimail/testing/fixtures";
import { describe, expect, it } from "vitest";
import { createSqliteJobQueue } from "./sqlite-job-queue.ts";
import { harness, mail, put } from "./test-support/harness.ts";

describe("account removal", () => {
  it("removes the signals of that account only (guards ghost signals after removal)", async () => {
    const h = harness();
    const other = "acc-2" as AccountId;
    await h.uow.run(async (tx) => {
      await tx.repositories.accounts.save(makeAccount());
      await tx.repositories.accounts.save(makeAccount({ id: other, address: "two@example.com" }));
      return ok(undefined);
    });
    await put(h, [
      mail(1, { subject: "Invoice april" }),
      mail(2, { subject: "Invoice april", accountId: other }),
    ]);
    await h.uow.run(async (tx) => {
      await tx.repositories.signals.replaceForMessages(
        WS_A,
        ["msg-1" as MessageId, "msg-2" as MessageId],
        ["msg-1", "msg-2"].map((id) => ({
          schemaVersion: 1 as const,
          workspaceId: WS_A,
          messageId: id as MessageId,
          kind: "has-document" as const,
          confidence: 0.9,
          detectedAt: "2026-01-01T00:00:00.000Z",
          reason: "A document is attached",
        })),
      );
      return ok(undefined);
    });
    await h.uow.run((tx) => tx.repositories.accounts.remove(WS_A, ACCOUNT_1));
    const signals = h.storage.reader.prepare("SELECT message_id FROM signal").all();
    expect(signals).toEqual([{ message_id: "msg-2" }]);
    expect(
      unwrap(await h.uow.reads.messages.query(WS_A, { accountId: ACCOUNT_1, limit: 10 })).items,
    ).toEqual([]);
    expect(
      unwrap(await h.uow.reads.messages.query(WS_A, { accountId: other, limit: 10 })).items.map(
        (m) => m.id,
      ),
    ).toEqual(["msg-2"]);
  });
});

describe("account removal: events, jobs, log and schema coverage", () => {
  it("purges the removed account's pending jobs and outbox rows and keeps the other account's (guards a removed account being synced again)", async () => {
    const h = harness();
    const queue = createSqliteJobQueue(h.storage, createFakeClock());
    const other = "acc-2" as AccountId;
    for (const [account, key] of [
      [ACCOUNT_1, "sync-1"],
      [other, "sync-2"],
    ] as const)
      unwrap(
        await queue.enqueue(WS_A, {
          type: "sync",
          payload: { accountId: account },
          idempotencyKey: key,
        }),
      );
    await h.uow.run(async (tx) => {
      await tx.outbox.append({
        kind: "job",
        workspaceId: WS_A,
        job: { type: "sync", payload: { accountId: ACCOUNT_1 }, idempotencyKey: "relay-1" },
      });
      return ok(undefined);
    });
    await h.uow.run((tx) => tx.repositories.accounts.remove(WS_A, ACCOUNT_1));
    const keys = h.storage.reader.prepare("SELECT idempotency_key FROM job").all();
    expect(keys).toEqual([{ idempotency_key: "sync-2" }]);
    expect(h.storage.reader.prepare("SELECT count(*) AS n FROM outbox").get()).toEqual({ n: 0 });
  });

  it("anonymises log entries in place and still refuses any other edit or delete (guards a rewritable audit trail)", async () => {
    const h = harness();
    await put(h, [mail(1)]);
    await h.uow.run((tx) => tx.repositories.actionLog.append(makeActionLog(1)));
    const before = h.storage.reader.prepare("SELECT seq, outcome, at FROM action_log").all();
    for (const sql of [
      "UPDATE action_log SET outcome = 'undone'",
      "UPDATE action_log SET command = NULL, inverse = NULL",
      "DELETE FROM action_log",
    ])
      expect(() => h.storage.writer.prepare(sql).run()).toThrow(/append-only/);
    await h.uow.run((tx) => tx.repositories.accounts.remove(WS_A, ACCOUNT_1));
    expect(h.storage.reader.prepare("SELECT seq, outcome, at FROM action_log").all()).toEqual(
      before,
    );
    const entry = unwrap(await h.uow.reads.actionLog.get(WS_A, makeActionLog(1).id));
    expect(entry.command).toEqual({ kind: "archive", messageIds: ["removed-1"] });
    expect(() =>
      h.storage.writer.prepare("UPDATE action_log SET outcome = 'undone'").run(),
    ).toThrow(/append-only/);
  });

  it("covers every table that has an account_id column, including one added later (guards a new account-scoped table surviving removal)", async () => {
    const h = harness();
    const scoped = () =>
      (
        h.storage.reader
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
          )
          .all() as { name: string }[]
      )
        .filter(({ name }) =>
          (
            h.storage.reader.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[]
          ).some((c) => c.name === "account_id"),
        )
        .map(({ name }) => name)
        .sort();
    // Adding an account-scoped table means adding it here on purpose; remove() finds it on its own.
    expect(scoped()).toEqual([
      "action_log",
      "cursor",
      "derived",
      "digest_state",
      "job",
      "keep_rule",
      "message",
      "outbox",
      "sender_stats",
      "suggestion",
      "thread",
    ]);
    h.storage.writer.exec(
      "CREATE TABLE later_scoped (workspace_id TEXT NOT NULL, account_id TEXT NOT NULL, note TEXT) STRICT",
    );
    h.storage.writer
      .prepare("INSERT INTO later_scoped VALUES (?, ?, 'x'), (?, 'acc-2', 'y')")
      .run(WS_A, ACCOUNT_1, WS_A);
    await h.uow.run((tx) => tx.repositories.accounts.remove(WS_A, ACCOUNT_1));
    expect(h.storage.reader.prepare("SELECT account_id FROM later_scoped").all()).toEqual([
      { account_id: "acc-2" },
    ]);
  });
});

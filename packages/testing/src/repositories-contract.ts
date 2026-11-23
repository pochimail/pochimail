import type { ActionId } from "@pochimail/actions/ids";
import { makeDerived } from "@pochimail/classification/testing/samples";
import { makeSignal } from "@pochimail/classification/testing/signal-repository-contract";
import { makeSuggestion } from "@pochimail/cleanup/testing/samples";
import type { Page } from "@pochimail/kernel/common";
import type { AccountId, MessageId, TopicId } from "@pochimail/kernel/ids";
import { ok, unwrap } from "@pochimail/kernel/result";
import { type Check, check, registerContract } from "@pochimail/kernel/testing/contract";
import { expect } from "vitest";
import {
  ACCOUNT_1,
  makeAccount,
  makeActionLog,
  makeIncomingMessage,
  makeSender,
  makeThread,
  makeTopic,
  WS_A,
  WS_B,
} from "./fixtures.ts";
import { type UnitOfWorkHarness, writeThrough as write } from "./unit-of-work-contract.ts";

type H = UnitOfWorkHarness;

async function drain<T>(
  next: (cursor?: string) => Promise<{ ok: true; value: Page<T> } | { ok: false }>,
) {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 100; guard++) {
    const r = await next(cursor);
    if (!r.ok) throw new Error("page failed");
    items.push(...r.value.items);
    if (r.value.nextCursor === null) return items;
    cursor = r.value.nextCursor;
  }
  throw new Error("cursor never ended");
}

export const repositoriesChecks: readonly Check<H>[] = [
  check("never returns another workspace's row (guards cross-workspace leaks)", async (h) => {
    await write(h, (tx) => tx.repositories.topics.save(makeTopic()));
    const other = await h.uow.reads.topics.get(WS_B, makeTopic().id);
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.error.code).toBe("storage.not_found");
    expect(await h.uow.reads.topics.list(WS_B)).toEqual(ok([]));
  }),
  check(
    "save replaces the row with the same id (guards duplicate rows after an update)",
    async (h) => {
      await write(h, (tx) => tx.repositories.accounts.save(makeAccount()));
      await write(h, (tx) =>
        tx.repositories.accounts.save(makeAccount({ address: "new@example.com" })),
      );
      const list = unwrap(await h.uow.reads.accounts.list(WS_A));
      expect(list.map((a) => a.address)).toEqual(["new@example.com"]);
    },
  ),
  check(
    "stores a copy, not the caller's object (guards later mutation corrupting stored data)",
    async (h) => {
      const topic = makeTopic();
      await write(h, (tx) => tx.repositories.topics.save(topic));
      (topic as { name: string }).name = "mutated after save";
      const stored = unwrap(await h.uow.reads.topics.get(WS_A, makeTopic().id));
      expect(stored.name).toBe("Trips");
      (stored as { name: string }).name = "mutated after read";
      expect(unwrap(await h.uow.reads.topics.get(WS_A, makeTopic().id)).name).toBe("Trips");
    },
  ),
  check("round-trips threads and senders (guards a repository dropping a field)", async (h) => {
    const thread = makeThread();
    const sender = makeSender();
    await write(h, async (tx) => {
      await tx.repositories.threads.upsert(thread);
      await tx.repositories.senders.upsert(sender);
    });
    expect(await h.uow.reads.threads.get(WS_A, thread.id)).toEqual(ok(thread));
    expect(await h.uow.reads.senders.get(WS_A, ACCOUNT_1, sender.address)).toEqual(ok(sender));
  }),
  check(
    "upsertMany twice leaves one row per message (guards a re-sync duplicating mail)",
    async (h) => {
      const batch = [makeIncomingMessage(1), makeIncomingMessage(2)];
      await write(h, (tx) => tx.repositories.messages.upsertMany(batch));
      await write(h, (tx) => tx.repositories.messages.upsertMany(batch));
      const all = await drain((cursor) =>
        h.uow.reads.messages.query(WS_A, {
          accountId: ACCOUNT_1,
          limit: 10,
          ...(cursor ? { cursor } : {}),
        }),
      );
      expect(all).toHaveLength(2);
    },
  ),
  check(
    "a re-sync keeps the category the user or classifier set (guards re-sync resetting categories)",
    async (h) => {
      const m = makeIncomingMessage(1);
      await write(h, (tx) => tx.repositories.messages.upsertMany([m]));
      await write(h, (tx) => tx.repositories.messages.setCategory(WS_A, m.id, "newsletters"));
      await write(h, (tx) => tx.repositories.messages.upsertMany([{ ...m, opened: true }]));
      const stored = unwrap(await h.uow.reads.messages.get(WS_A, m.id));
      expect(stored.category).toBe("newsletters");
      expect(stored.opened).toBe(true);
    },
  ),
  check(
    "countByCategory counts only the selected accounts and lists every category (guards counts leaking across accounts)",
    async (h) => {
      const other = "acc-2" as AccountId;
      await write(h, (tx) =>
        tx.repositories.messages.upsertMany([
          makeIncomingMessage(1),
          makeIncomingMessage(2),
          makeIncomingMessage(3, { accountId: other }),
        ]),
      );
      await write(h, (tx) =>
        tx.repositories.messages.setCategory(WS_A, makeIncomingMessage(1).id, "newsletters"),
      );
      const one = unwrap(await h.uow.reads.messages.countByCategory(WS_A, [ACCOUNT_1]));
      expect(Object.values(one).reduce((a, b) => a + b, 0)).toBe(2);
      expect(one.newsletters).toBe(1);
      expect(one.promotions).toBe(0);
      const none = unwrap(await h.uow.reads.messages.countByCategory(WS_A, []));
      expect(Object.values(none).every((n) => n === 0)).toBe(true);
    },
  ),
  check(
    "setCategory on an unknown message is NotFound (guards silently ignoring a bad id)",
    async (h) => {
      await write(h, async (tx) => {
        const r = await tx.repositories.messages.setCategory(WS_A, "nope" as MessageId, "people");
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code).toBe("storage.not_found");
      });
    },
  ),
  check(
    "query filters by category and sender, newest first (guards wrong or unordered review lists)",
    async (h) => {
      const batch = [
        makeIncomingMessage(1, { from: "a@example.com" }),
        makeIncomingMessage(2, { from: "b@example.com" }),
        makeIncomingMessage(3, { from: "a@example.com" }),
      ];
      await write(h, async (tx) => {
        await tx.repositories.messages.upsertMany(batch);
        await tx.repositories.messages.setCategory(WS_A, batch[0]?.id as MessageId, "promotions");
        await tx.repositories.messages.setCategory(WS_A, batch[1]?.id as MessageId, "promotions");
        await tx.repositories.messages.setCategory(WS_A, batch[2]?.id as MessageId, "people");
      });
      const base = { accountId: ACCOUNT_1, limit: 10 };
      const promos = unwrap(
        await h.uow.reads.messages.query(WS_A, { ...base, category: "promotions" }),
      );
      expect(promos.items.map((m) => m.id)).toEqual(["msg-2", "msg-1"]);
      const fromA = unwrap(
        await h.uow.reads.messages.query(WS_A, { ...base, senderAddress: "a@example.com" }),
      );
      expect(fromA.items.map((m) => m.id)).toEqual(["msg-3", "msg-1"]);
      expect(unwrap(await h.uow.reads.messages.query(WS_B, base)).items).toEqual([]);
    },
  ),
  check(
    "paging by cursor visits every row once (guards skipped or repeated rows between pages)",
    async (h) => {
      const batch = Array.from({ length: 7 }, (_, i) => makeIncomingMessage(i + 1));
      await write(h, (tx) => tx.repositories.messages.upsertMany(batch));
      const first = unwrap(
        await h.uow.reads.messages.query(WS_A, { accountId: ACCOUNT_1, limit: 3 }),
      );
      expect(first.items).toHaveLength(3);
      expect(first.nextCursor).not.toBeNull();
      const all = await drain((cursor) =>
        h.uow.reads.messages.query(WS_A, {
          accountId: ACCOUNT_1,
          limit: 3,
          ...(cursor ? { cursor } : {}),
        }),
      );
      expect(all.map((m) => m.id).sort()).toEqual(batch.map((m) => m.id).sort());
    },
  ),
  check(
    "the action log is append-only (guards an entry being rewritten, which would break undo)",
    async (h) => {
      const original = makeActionLog(1);
      await write(h, (tx) => tx.repositories.actionLog.append(original));
      await write(h, async (tx) => {
        await tx.repositories.actionLog.append({ ...original, outcome: "undone" });
      });
      expect(unwrap(await h.uow.reads.actionLog.get(WS_A, original.id)).outcome).toBe("applied");
    },
  ),
  check(
    "lists log entries for one action, oldest first (guards undo reading another action's entries)",
    async (h) => {
      await write(h, async (tx) => {
        await tx.repositories.actionLog.append(makeActionLog(1));
        await tx.repositories.actionLog.append(makeActionLog(2, { actionId: "act-2" as ActionId }));
        await tx.repositories.actionLog.append(makeActionLog(3, { outcome: "undone" }));
      });
      const entries = unwrap(await h.uow.reads.actionLog.listForAction(WS_A, "act-1" as ActionId));
      expect(entries.map((e) => e.id)).toEqual(["log-1", "log-3"]);
    },
  ),
  check(
    "sync cursors are per account and scope (guards one folder's cursor overwriting another's)",
    async (h) => {
      expect(await h.uow.reads.cursors.get(WS_A, ACCOUNT_1, "inbox")).toEqual(ok(null));
      await write(h, async (tx) => {
        await tx.repositories.cursors.set(WS_A, ACCOUNT_1, { scope: "inbox", token: "t1" });
        await tx.repositories.cursors.set(WS_A, ACCOUNT_1, { scope: "sent", token: "t2" });
      });
      expect(await h.uow.reads.cursors.get(WS_A, ACCOUNT_1, "inbox")).toEqual(
        ok({ scope: "inbox", token: "t1" }),
      );
      expect(await h.uow.reads.cursors.get(WS_B, ACCOUNT_1, "inbox")).toEqual(ok(null));
    },
  ),
  check(
    "removing an account deletes every row scoped to it, its pending events and jobs, anonymises its log entries, and changes nothing else (guards leftovers of a removed account and collateral deletes)",
    async (h) => {
      const other = "acc-2" as AccountId;
      const keep = makeIncomingMessage(9, { accountId: other });
      const event = (account: AccountId, id: string) =>
        ({
          kind: "event",
          event: {
            id,
            type: "MessagesUpserted",
            version: 1,
            workspaceId: WS_A,
            occurredAt: "2026-01-01T00:00:00.000Z",
            payload: { accountId: account, count: 1 },
          },
        }) as const;
      const job = (account: AccountId, key: string) =>
        ({
          kind: "job",
          workspaceId: WS_A,
          job: { type: "sync", payload: { accountId: account }, idempotencyKey: key },
        }) as const;
      await write(h, async (tx) => {
        await tx.repositories.accounts.save(makeAccount());
        await tx.repositories.accounts.save(makeAccount({ id: other, address: "two@example.com" }));
        await tx.repositories.messages.upsertMany([makeIncomingMessage(1), keep]);
        await tx.repositories.derived.save(makeDerived(1));
        await tx.repositories.derived.save(makeDerived(9, { accountId: other }));
        await tx.repositories.signals.replaceForMessages(WS_A, ["msg-1", "msg-9"] as MessageId[], [
          makeSignal(1),
          makeSignal(9),
        ]);
        await tx.repositories.threads.upsert(makeThread());
        await tx.repositories.senders.upsert(makeSender());
        await tx.repositories.suggestions.save(makeSuggestion());
        await tx.repositories.cursors.set(WS_A, ACCOUNT_1, { scope: "inbox", token: "t1" });
        await tx.repositories.cursors.set(WS_A, other, { scope: "inbox", token: "t2" });
        await tx.repositories.digestState.set(WS_A, ACCOUNT_1, "2026-01-01T00:00:00.000Z");
        await tx.repositories.actionLog.append(
          makeActionLog(1, { command: { kind: "archive", messageIds: ["msg-1" as MessageId] } }),
        );
        await tx.repositories.topics.save(makeTopic());
        await tx.outbox.append(event(ACCOUNT_1, "e-gone"));
        await tx.outbox.append(event(other, "e-kept"));
        await tx.outbox.append(job(ACCOUNT_1, "j-gone"));
        await tx.outbox.append(job(other, "j-kept"));
      });
      await write(h, (tx) => tx.repositories.accounts.remove(WS_A, ACCOUNT_1));
      const reads = h.uow.reads;
      expect(unwrap(await reads.accounts.list(WS_A)).map((a) => a.id)).toEqual([other]);
      expect((await reads.messages.get(WS_A, "msg-1" as MessageId)).ok).toBe(false);
      expect((await reads.messages.get(WS_A, keep.id)).ok).toBe(true);
      expect((await reads.derived.get(WS_A, "msg-1" as MessageId)).ok).toBe(false);
      expect((await reads.derived.get(WS_A, "msg-9" as MessageId)).ok).toBe(true);
      expect(
        unwrap(await reads.signals.listForMessages(WS_A, ["msg-1", "msg-9"] as MessageId[])).map(
          (s) => s.messageId,
        ),
      ).toEqual(["msg-9"]);
      expect((await reads.threads.get(WS_A, makeThread().id)).ok).toBe(false);
      expect((await reads.senders.get(WS_A, ACCOUNT_1, makeSender().address)).ok).toBe(false);
      expect((await reads.suggestions.get(WS_A, makeSuggestion().id)).ok).toBe(false);
      expect(unwrap(await reads.cursors.get(WS_A, ACCOUNT_1, "inbox"))).toBeNull();
      expect(unwrap(await reads.cursors.get(WS_A, other, "inbox"))).toEqual({
        scope: "inbox",
        token: "t2",
      });
      expect(unwrap(await reads.digestState.get(WS_A, ACCOUNT_1))).toBeNull();
      expect(unwrap(await reads.topics.list(WS_A))).toHaveLength(1);
      const pending = JSON.stringify(await h.committedOutbox());
      expect(pending).toContain("e-kept");
      expect(pending).toContain("j-kept");
      expect(pending).not.toContain("e-gone");
      expect(pending).not.toContain("j-gone");
      const entry = unwrap(await reads.actionLog.get(WS_A, makeActionLog(1).id));
      expect(entry.command.kind).toBe("archive");
      expect(entry.outcome).toBe("applied");
      expect(entry.at).toBe(makeActionLog(1).at);
      expect(JSON.stringify(entry)).not.toContain('msg-1"');
    },
  ),
  check("topics list returns every saved topic (guards a repository losing rows)", async (h) => {
    await write(h, async (tx) => {
      await tx.repositories.topics.save(makeTopic());
      await tx.repositories.topics.save(makeTopic({ id: "topic-2" as TopicId, name: "Taxes" }));
    });
    const names = unwrap(await h.uow.reads.topics.list(WS_A))
      .map((t) => t.name)
      .sort();
    expect(names).toEqual(["Taxes", "Trips"]);
  }),
];

/** Contract for the repositories behind any `UnitOfWork`. Reuse unchanged for SQLite in M2. */
export function repositoriesContract(make: () => H | Promise<H>): void {
  registerContract("Repositories contract", repositoriesChecks, make);
}

import type { AccountId, MessageId, ThreadId, TopicId, WorkspaceId } from "@pochimail/kernel/ids";
import { ok, unwrap } from "@pochimail/kernel/result";
import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "../model/message.ts";
import type { MailboxUnitOfWork } from "../ports/unit-of-work.ts";

export const WS_A = "ws-a" as WorkspaceId;
export const ACCOUNT_1 = "acc-1" as AccountId;

/** A valid unclassified message for contract and use-case tests; no real address. */
export const makeIncoming = (n: number, over: Partial<IncomingMessage> = {}): IncomingMessage => ({
  schemaVersion: 1,
  id: `msg-${n}` as MessageId,
  workspaceId: WS_A,
  accountId: ACCOUNT_1,
  threadId: `thr-${n}` as ThreadId,
  from: `sender${n}@example.com`,
  to: ["owner@example.com"],
  subject: `Subject ${n}`,
  snippet: `Snippet ${n}`,
  receivedAt: new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString(),
  hasListUnsubscribe: false,
  opened: false,
  topicIds: [] as TopicId[],
  ...over,
});

/** Contract of the message, thread and cursor repositories behind any `MailboxUnitOfWork`. */
export function mailboxRepositoryContract(make: () => { uow: MailboxUnitOfWork }): void {
  const put = async (uow: MailboxUnitOfWork, messages: IncomingMessage[]) => {
    const r = await uow.run(async (tx) => tx.repositories.messages.upsertMany(messages));
    expect(r.ok).toBe(true);
  };
  describe("Mailbox repository contract", () => {
    it("upserting the same message again changes nothing and keeps its label (guards lost classification on re-sync)", async () => {
      const { uow } = make();
      await put(uow, [makeIncoming(1)]);
      const label = "newsletter";
      unwrap(
        await uow.run(async (tx) =>
          tx.repositories.messages.setCategory(WS_A, makeIncoming(1).id, label),
        ),
      );
      await put(uow, [makeIncoming(1)]);
      expect(unwrap(await uow.reads.messages.get(WS_A, makeIncoming(1).id)).category).toBe(label);
    });
    it("topics set by classification survive a re-sync and are replaced on the next set (guards lost topics on every scan)", async () => {
      const { uow } = make();
      const id = makeIncoming(1).id;
      const topics = ["top_1" as TopicId, "top_2" as TopicId];
      await put(uow, [makeIncoming(1)]);
      unwrap(await uow.run(async (tx) => tx.repositories.messages.setTopics(WS_A, id, topics)));
      await put(uow, [makeIncoming(1)]);
      expect(unwrap(await uow.reads.messages.get(WS_A, id)).topicIds).toEqual(topics);
      unwrap(await uow.run(async (tx) => tx.repositories.messages.setTopics(WS_A, id, [])));
      expect(unwrap(await uow.reads.messages.get(WS_A, id)).topicIds).toEqual([]);
    });
    it("the ingest sequence only grows on a first insert (guards 'stored since' missing late mail)", async () => {
      const { uow } = make();
      await put(uow, [makeIncoming(2), makeIncoming(1)]);
      const after = unwrap(await uow.reads.messages.latestSequence(WS_A, ACCOUNT_1));
      await put(uow, [makeIncoming(1, { subject: "edited" })]);
      expect(unwrap(await uow.reads.messages.latestSequence(WS_A, ACCOUNT_1))).toBe(after);
      await put(uow, [makeIncoming(3)]);
      expect(unwrap(await uow.reads.messages.latestSequence(WS_A, ACCOUNT_1))).toBe(after + 1);
    });
    it("never returns another workspace's message (guards cross-workspace leaks)", async () => {
      const { uow } = make();
      await put(uow, [makeIncoming(1)]);
      const other = await uow.reads.messages.get("ws-b" as WorkspaceId, makeIncoming(1).id);
      expect(other.ok).toBe(false);
    });
    it("ofMessage tells whether the owner sent a message and gives the sender's stats, by what ingest stored (guards a lost sender once the address is dropped)", async () => {
      const { uow } = make();
      const owner = "owner@example.com";
      await put(uow, [
        makeIncoming(1, { from: "boss@example.com" }),
        makeIncoming(2, { from: owner }),
      ]);
      unwrap(
        await uow.run(async (tx) =>
          tx.repositories.senders.upsert({
            schemaVersion: 1,
            workspaceId: WS_A,
            accountId: ACCOUNT_1,
            address: "boss@example.com",
            messageCount: 1,
            openedCount: 0,
            repliedCount: 4,
            lastMessageAt: "2026-01-01T00:00:00.000Z",
            vip: true,
          }),
        ),
      );
      const theirs = unwrap(await uow.reads.senders.ofMessage(WS_A, makeIncoming(1).id, owner));
      expect([theirs.fromOwner, theirs.stats?.repliedCount, theirs.stats?.vip]).toEqual([
        false,
        4,
        true,
      ]);
      const mine = unwrap(await uow.reads.senders.ofMessage(WS_A, makeIncoming(2).id, owner));
      expect(mine.fromOwner).toBe(true);
      expect((await uow.reads.senders.ofMessage(WS_A, makeIncoming(9).id, owner)).ok).toBe(false);
    });
    it("ofMessage matches the owner whatever the case of From or of the owner address (guards a false needs-reply on the owner's own mail)", async () => {
      const { uow } = make();
      await put(uow, [
        makeIncoming(1, { from: "Owner@Example.COM" }),
        makeIncoming(2, { from: "owner@example.com" }),
        makeIncoming(3, { from: "Boss@Example.COM" }),
      ]);
      const fromOwner = async (n: number, owner: string) =>
        unwrap(await uow.reads.senders.ofMessage(WS_A, makeIncoming(n).id, owner)).fromOwner;
      expect(await fromOwner(1, "owner@example.com")).toBe(true);
      expect(await fromOwner(2, "OWNER@example.com")).toBe(true);
      expect(await fromOwner(3, "owner@example.com")).toBe(false);
    });
    it("pages newest first and ends with a null cursor (guards skipped or repeated rows)", async () => {
      const { uow } = make();
      await put(uow, [makeIncoming(1), makeIncoming(2), makeIncoming(3)]);
      const first = unwrap(
        await uow.reads.messages.query(WS_A, { accountId: ACCOUNT_1, limit: 2 }),
      );
      expect(first.items.map((m) => m.id)).toEqual(["msg-3", "msg-2"]);
      const cursor = first.nextCursor ?? undefined;
      const rest = unwrap(
        await uow.reads.messages.query(WS_A, {
          accountId: ACCOUNT_1,
          limit: 2,
          ...(cursor ? { cursor } : {}),
        }),
      );
      expect(rest.items.map((m) => m.id)).toEqual(["msg-1"]);
      expect(rest.nextCursor).toBeNull();
    });
    it("a cursor is null until set, then returned per scope (guards restarting a backfill)", async () => {
      const { uow } = make();
      expect(await uow.reads.cursors.get(WS_A, ACCOUNT_1, "inbox")).toEqual(ok(null));
      unwrap(
        await uow.run(async (tx) =>
          tx.repositories.cursors.set(WS_A, ACCOUNT_1, { scope: "inbox", token: "5" }),
        ),
      );
      expect(unwrap(await uow.reads.cursors.get(WS_A, ACCOUNT_1, "inbox"))).toEqual({
        scope: "inbox",
        token: "5",
      });
      expect(await uow.reads.cursors.get(WS_A, ACCOUNT_1, "sent")).toEqual(ok(null));
    });
  });
}

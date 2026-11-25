import type { Clock } from "@pochimail/kernel/clock";
import type { CancelSignal } from "@pochimail/kernel/common";
import { StorageError } from "@pochimail/kernel/errors";
import type { IdGenerator } from "@pochimail/kernel/id-generator";
import { MessageId, WorkspaceId } from "@pochimail/kernel/ids";
import { err, ok, unwrap } from "@pochimail/kernel/result";
import { describe, expect, it } from "vitest";
import { ActionId } from "../ids.ts";
import type { Action, Command } from "../model/action.ts";
import type { MailCommands } from "../ports/mail-commands.ts";
import type { ActionsUnitOfWork } from "../ports/unit-of-work.ts";
import { ApplyAction, type ApplyActionItem } from "../use-cases/apply-action.ts";
import { ResolvePendingActions } from "../use-cases/resolve-pending-actions.ts";
import { UndoAction } from "../use-cases/undo-action.ts";

/**
 * What the suite needs from a mailbox + storage pair. Adapters (SQLite, real providers against
 * fixtures) implement it and run `describeActionUseCases` unchanged.
 */
export interface ActionHarness {
  readonly uow: ActionsUnitOfWork;
  readonly provider: MailCommands;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /** Mailbox state as the provider sees it. */
  isArchived(messageId: string): Promise<boolean>;
  /** Number of mutations the provider actually performed (replays must not add any). */
  mutations(): number;
  /** Makes the provider fail for every command touching one of these messages. */
  failFor(messageIds: readonly string[]): void;
}

const signal: CancelSignal = {
  aborted: false,
  addEventListener() {},
  removeEventListener() {},
};
const ws = unwrap(WorkspaceId("wsp_1"));
const confirmed: ApplyActionItem["authorization"] = {
  autonomy: "suggest",
  categories: ["newsletters"],
  protectedCategories: ["people"],
  confidence: 0.95,
  userConfirmed: true,
};

function item(
  n: number,
  kind: Command["kind"],
  authorization: ApplyActionItem["authorization"] = confirmed,
  key = `key-${n}`,
): ApplyActionItem {
  const action: Action = {
    schemaVersion: 1,
    id: unwrap(ActionId(`act_${n}`)),
    workspaceId: ws,
    idempotencyKey: key,
    command: { kind, messageIds: [unwrap(MessageId(`m${n}`))] },
    createdAt: "2026-11-17T10:00:00.000Z",
  };
  return { action, authorization };
}

/** The process dies after the provider acted: only `pending` entries reach the log, nothing after them. */
const crashingAfterProviderCall = (uow: ActionsUnitOfWork): ActionsUnitOfWork => ({
  reads: uow.reads,
  run: (work, runSignal) =>
    uow.run(
      (tx) =>
        work({
          ...tx,
          repositories: {
            actionLog: {
              ...tx.repositories.actionLog,
              append: async (entry) =>
                entry.outcome === "pending"
                  ? tx.repositories.actionLog.append(entry)
                  : err(new StorageError("crash")),
            },
          },
        }),
      runSignal,
    ),
});

export function describeActionUseCases(name: string, create: () => ActionHarness): void {
  describe(`action use cases: ${name}`, () => {
    const usecases = (h: ActionHarness) => ({
      apply: new ApplyAction(h),
      undo: new UndoAction(h),
    });

    it("applying the same idempotency key twice mutates the provider once", async () => {
      const h = create();
      const first = await usecases(h).apply.execute({ items: [item(1, "archive")] }, signal);
      // A fresh instance (as after a restart) must still see the key in the log.
      const again = await usecases(h).apply.execute({ items: [item(1, "archive")] }, signal);
      expect(first.outcomes[0]?.status).toBe("applied");
      expect(again.outcomes[0]?.status).toBe("already-applied");
      expect(h.mutations()).toBe(1);
    });

    it("undo from a fresh use case instance restores the prior state", async () => {
      const h = create();
      await usecases(h).apply.execute({ batchId: "b1", items: [item(1, "archive")] }, signal);
      expect(await h.isArchived("m1")).toBe(true);
      const report = unwrap(
        await usecases(h).undo.execute(
          { workspaceId: ws, actionId: unwrap(ActionId("act_1")) },
          signal,
        ),
      );
      expect(report.outcomes[0]?.status).toBe("undone");
      expect(await h.isArchived("m1")).toBe(false);
    });

    it("a provider failure mid-batch is logged as failed and undo reverses only applied actions", async () => {
      const h = create();
      h.failFor(["m2"]);
      const { apply, undo } = usecases(h);
      const report = await apply.execute(
        { batchId: "b1", items: [item(1, "archive"), item(2, "archive"), item(3, "archive")] },
        signal,
      );
      expect(report.outcomes.map((o) => o.status)).toEqual(["applied", "failed", "applied"]);
      const logged = unwrap(await h.uow.reads.actionLog.listForBatch(ws, "b1"));
      expect(logged.map((e) => e.outcome)).toEqual([
        "pending",
        "applied",
        "pending",
        "failed",
        "pending",
        "applied",
      ]);

      const before = h.mutations();
      const undone = unwrap(await undo.execute({ workspaceId: ws, batchId: "b1" }, signal));
      expect(undone.outcomes.map((o) => o.status).sort()).toEqual([
        "not-applied",
        "undone",
        "undone",
      ]);
      expect(h.mutations() - before).toBe(2);
      expect(await h.isArchived("m1")).toBe(false);
      expect(await h.isArchived("m3")).toBe(false);
    });

    it("an unauthorized action never reaches the provider and is logged as refused", async () => {
      const h = create();
      const readOnly = { ...confirmed, autonomy: "just-look" as const };
      const report = await usecases(h).apply.execute(
        { items: [item(1, "archive", readOnly)] },
        signal,
      );
      expect(report.outcomes[0]).toMatchObject({ status: "refused", reason: "read-only" });
      expect(h.mutations()).toBe(0);
      const logged = unwrap(await h.uow.reads.actionLog.listForKey(ws, "key-1"));
      expect(logged).toMatchObject([{ outcome: "refused", denialReason: "read-only" }]);
    });

    it("an unsubscribe is logged irreversible and undo does not send anything", async () => {
      const h = create();
      await usecases(h).apply.execute({ items: [item(1, "unsubscribe")] }, signal);
      const before = h.mutations();
      const report = unwrap(
        await usecases(h).undo.execute(
          { workspaceId: ws, actionId: unwrap(ActionId("act_1")) },
          signal,
        ),
      );
      expect(report.outcomes[0]?.status).toBe("irreversible");
      expect(h.mutations()).toBe(before);
    });

    describe("a crash between the provider call and the log write", () => {
      const crash = async (h: ActionHarness, n: number, kind: Command["kind"]) => {
        const report = await new ApplyAction({
          ...h,
          uow: crashingAfterProviderCall(h.uow),
        }).execute({ items: [item(n, kind)] }, signal);
        expect(report.outcomes[0]?.status).toBe("failed");
      };
      // A fresh instance over the same storage, as after a restart.
      const restart = (h: ActionHarness) =>
        new ResolvePendingActions({ ...h, providerFor: async () => ok(h.provider) }).execute(
          ws,
          signal,
        );

      it("after restart the change is in Activity and Undo reverses it (guards a mailbox change that can no longer be undone)", async () => {
        const h = create();
        await crash(h, 1, "archive");
        expect(await h.isArchived("m1")).toBe(true);

        expect(unwrap(await restart(h))).toEqual({ settled: 1, deferred: 0 });
        const activity = unwrap(await h.uow.reads.actionLog.list(ws, { limit: 50 }));
        expect(activity.items.map((e) => e.outcome)).toEqual(["pending", "applied"]);

        const undone = unwrap(
          await usecases(h).undo.execute(
            { workspaceId: ws, actionId: unwrap(ActionId("act_1")) },
            signal,
          ),
        );
        expect(undone.outcomes[0]?.status).toBe("undone");
        expect(await h.isArchived("m1")).toBe(false);
      });

      it("a deletion left pending is restored from the Trash by Undo (guards a trashed email with no way back)", async () => {
        const h = create();
        await crash(h, 1, "trash");
        unwrap(await restart(h));
        const logged = unwrap(
          await h.uow.reads.actionLog.listForAction(ws, unwrap(ActionId("act_1"))),
        );
        expect(logged.at(-1)).toMatchObject({
          outcome: "applied",
          inverse: { kind: "untrash" },
        });
      });

      it("resolving twice, or after a normal apply, does not touch the provider (guards a replay of finished work)", async () => {
        const h = create();
        await usecases(h).apply.execute({ items: [item(1, "archive")] }, signal);
        await crash(h, 2, "archive");
        unwrap(await restart(h));
        const before = h.mutations();
        expect(unwrap(await restart(h))).toEqual({ settled: 0, deferred: 0 });
        expect(h.mutations()).toBe(before);
      });

      it("a pending unsubscribe is never sent again (guards a duplicate request leaving the device)", async () => {
        const h = create();
        await crash(h, 1, "unsubscribe");
        const before = h.mutations();
        expect(unwrap(await restart(h))).toEqual({ settled: 1, deferred: 0 });
        expect(h.mutations()).toBe(before);
        const logged = unwrap(await h.uow.reads.actionLog.listForKey(ws, "key-1"));
        expect(logged.map((e) => e.outcome)).toEqual(["pending", "failed"]);
      });

      it("an unreachable provider leaves the entry pending for the next start (guards an entry lost while offline)", async () => {
        const h = create();
        await crash(h, 1, "archive");
        h.failFor(["m1"]);
        expect(unwrap(await restart(h))).toEqual({ settled: 0, deferred: 1 });
        const pending = unwrap(await h.uow.reads.actionLog.listPending(ws));
        expect(pending).toHaveLength(1);
      });
    });
  });
}

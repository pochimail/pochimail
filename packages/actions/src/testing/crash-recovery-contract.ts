import { Cancelled, ProviderFailed, StorageError } from "@pochimail/kernel/errors";
import { err, ok, unwrap } from "@pochimail/kernel/result";
import { describe, expect, it } from "vitest";
import { ActionId } from "../ids.ts";
import type { Command } from "../model/action.ts";
import type { MailCommands } from "../ports/mail-commands.ts";
import type { ActionsUnitOfWork } from "../ports/unit-of-work.ts";
import { ApplyAction } from "../use-cases/apply-action.ts";
import { MAX_REPLAY_AGE_MS, ResolvePendingActions } from "../use-cases/resolve-pending-actions.ts";
import { UndoAction } from "../use-cases/undo-action.ts";
import { type ActionHarness, FAR_FUTURE, item, signal, ws } from "./contract-support.ts";

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

/** Crash recovery: what a restart does with the `pending` entries a crash left behind. */
export function describeCrashRecovery(name: string, create: () => ActionHarness): void {
  describe(`crash recovery: ${name}`, () => {
    const undo = (h: ActionHarness) => new UndoAction(h);

    describe("a crash between the provider call and the log write", () => {
      const crash = async (h: ActionHarness, n: number, kind: Command["kind"]) => {
        const report = await new ApplyAction({
          ...h,
          uow: crashingAfterProviderCall(h.uow),
        }).execute({ items: [item(n, kind)] }, signal);
        expect(report.outcomes[0]?.status).toBe("failed");
      };
      // A fresh instance over the same storage, as after a restart.
      const restart = (h: ActionHarness, later = 0) =>
        new ResolvePendingActions({
          ...h,
          clock: { now: () => new Date(h.clock.now().getTime() + later) },
          providerFor: async () => ok(h.provider),
        }).execute(ws, new Date(h.clock.now().getTime() + 1).toISOString(), signal);

      it("after restart the change is in Activity and Undo reverses it (guards a mailbox change that can no longer be undone)", async () => {
        const h = create();
        await crash(h, 1, "archive");
        expect(await h.isArchived("m1")).toBe(true);

        expect(unwrap(await restart(h))).toEqual({ settled: 1, deferred: 0 });
        const activity = unwrap(await h.uow.reads.actionLog.list(ws, { limit: 50 }));
        expect(activity.items.map((e) => e.outcome)).toEqual(["pending", "applied"]);

        const undone = unwrap(
          await undo(h).execute({ workspaceId: ws, actionId: unwrap(ActionId("act_1")) }, signal),
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
        await new ApplyAction(h).execute({ items: [item(1, "archive")] }, signal);
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
        expect(logged[1]?.errorCode).toBe("action.outcome_unknown");
      });

      it("an unreachable provider leaves the entry pending for the next start (guards an entry lost while offline)", async () => {
        const h = create();
        await crash(h, 1, "archive");
        h.failFor(["m1"]);
        expect(unwrap(await restart(h))).toEqual({ settled: 0, deferred: 1 });
        const pending = unwrap(await h.uow.reads.actionLog.listPending(ws, FAR_FUTURE));
        expect(pending).toHaveLength(1);
      });

      it("a retry after a failure that crashes is recovered, an earlier failure does not hide it (guards a retried action lost after a crash)", async () => {
        const h = create();
        h.failFor(["m1"]);
        const failed = await new ApplyAction(h).execute({ items: [item(1, "archive")] }, signal);
        expect(failed.outcomes[0]?.status).toBe("failed");
        expect(unwrap(await h.uow.reads.actionLog.listPending(ws, FAR_FUTURE))).toEqual([]);

        h.failFor([]);
        await crash(h, 1, "archive");
        expect(unwrap(await h.uow.reads.actionLog.listPending(ws, FAR_FUTURE))).toHaveLength(1);

        expect(unwrap(await restart(h))).toEqual({ settled: 1, deferred: 0 });
        const logged = unwrap(await h.uow.reads.actionLog.listForKey(ws, "key-1"));
        expect(logged.map((e) => e.outcome)).toEqual(["pending", "failed", "pending", "applied"]);
        expect(await h.isArchived("m1")).toBe(true);
      });

      it("a provider.failed answer leaves the entry pending for the next start (guards an action given up on a provider hiccup)", async () => {
        const h = create();
        await crash(h, 1, "archive");
        h.failNext(new ProviderFailed());
        expect(unwrap(await restart(h))).toEqual({ settled: 0, deferred: 1 });
        expect(unwrap(await restart(h))).toEqual({ settled: 1, deferred: 0 });
        const logged = unwrap(await h.uow.reads.actionLog.listForKey(ws, "key-1"));
        expect(logged.map((e) => e.outcome)).toEqual(["pending", "applied"]);
      });

      it("an entry still deferred after the replay window is closed failed (guards an endless replay)", async () => {
        const h = create();
        await crash(h, 1, "archive");
        h.failFor(["m1"]);
        expect(unwrap(await restart(h, MAX_REPLAY_AGE_MS - 1000))).toEqual({
          settled: 0,
          deferred: 1,
        });
        expect(unwrap(await restart(h, MAX_REPLAY_AGE_MS + 1000))).toEqual({
          settled: 1,
          deferred: 0,
        });
        const logged = unwrap(await h.uow.reads.actionLog.listForKey(ws, "key-1"));
        expect(logged.at(-1)).toMatchObject({
          outcome: "failed",
          errorCode: "action.replay_expired",
        });
        expect(unwrap(await h.uow.reads.actionLog.listPending(ws, FAR_FUTURE))).toEqual([]);
      });

      it("a cancelled action is closed failed and never replayed (guards the user's cancel undone by a restart)", async () => {
        const h = create();
        const cancelling: MailCommands = {
          ...h.provider,
          applyCommands: async () => err(new Cancelled()),
        };
        const report = await new ApplyAction({ ...h, provider: cancelling }).execute(
          { items: [item(1, "archive")] },
          signal,
        );
        expect(report.cancelled).toBe(true);
        const logged = unwrap(await h.uow.reads.actionLog.listForKey(ws, "key-1"));
        expect(logged.at(-1)).toMatchObject({
          outcome: "failed",
          errorCode: "operation.cancelled",
        });

        expect(unwrap(await restart(h))).toEqual({ settled: 0, deferred: 0 });
        expect(h.mutations()).toBe(0);
      });

      it("an entry written after the start is left alone (guards a replay racing an action running now)", async () => {
        const h = create();
        await crash(h, 1, "archive");
        const bootedAt = new Date(h.clock.now().getTime() - 1).toISOString();
        const report = await new ResolvePendingActions({
          ...h,
          providerFor: async () => ok(h.provider),
        }).execute(ws, bootedAt, signal);
        expect(unwrap(report)).toEqual({ settled: 0, deferred: 0 });
        expect(h.mutations()).toBe(1);
        expect(unwrap(await h.uow.reads.actionLog.listPending(ws, FAR_FUTURE))).toHaveLength(1);
      });
    });
  });
}

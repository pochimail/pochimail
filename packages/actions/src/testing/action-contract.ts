import { unwrap } from "@pochimail/kernel/result";
import { describe, expect, it } from "vitest";
import { ActionId } from "../ids.ts";
import { ApplyAction } from "../use-cases/apply-action.ts";
import { UndoAction } from "../use-cases/undo-action.ts";
import { type ActionHarness, confirmed, item, signal, ws } from "./contract-support.ts";
import { describeCrashRecovery } from "./crash-recovery-contract.ts";

export function describeActionUseCases(name: string, create: () => ActionHarness): void {
  describeCrashRecovery(name, create);
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
  });
}

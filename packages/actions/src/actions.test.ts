import { MessageId, WorkspaceId } from "@pochimail/kernel/ids";
import { unwrap } from "@pochimail/kernel/result";
import { expect, it } from "vitest";
import { ActionId } from "./ids.ts";
import { authorize } from "./policies/authorize.ts";
import { describeActionUseCases } from "./testing/action-contract.ts";
import { BASE_CAPABILITIES, createActionHarness } from "./testing/action-harness.ts";
import { createInMemoryActions } from "./testing/in-memory-actions.ts";
import { authorizeContract } from "./testing/policy-contract.ts";
import { ApplyAction } from "./use-cases/apply-action.ts";
import { UndoAction } from "./use-cases/undo-action.ts";

const memory = (capabilities: Parameters<typeof createActionHarness>[0]) =>
  createActionHarness(capabilities, createInMemoryActions().uow);

describeActionUseCases("one command per call", () =>
  memory({ ...BASE_CAPABILITIES, batchModify: null }),
);
describeActionUseCases("batch modify, folders", () =>
  memory({
    ...BASE_CAPABILITIES,
    organization: "folders",
    archive: "move-to-archive-folder",
    batchModify: { maxCommands: 50 },
  }),
);

// Guards: a half-applied action whose applied part cannot be undone, or an undo that touches the rest.
it("a provider failing part-way logs the applied part as applied and undo restores exactly that part", async () => {
  const h = memory({ ...BASE_CAPABILITIES, batchModify: { maxCommands: 50 } });
  const ws = unwrap(WorkspaceId("wsp_1"));
  const ids = [1, 2, 3].map((n) => unwrap(MessageId(`m${n}`)));
  h.failPartlyAt("m3");
  const apply = new ApplyAction(h);
  const report = await apply.execute(
    {
      items: [
        {
          action: {
            schemaVersion: 1,
            id: unwrap(ActionId("act_1")),
            workspaceId: ws,
            idempotencyKey: "k1",
            command: { kind: "archive", messageIds: ids },
            createdAt: "2026-11-17T10:00:00.000Z",
          },
          authorization: {
            autonomy: "suggest",
            categories: ["newsletters"],
            protectedCategories: ["people"],
            confidence: 0.95,
            userConfirmed: true,
          },
        },
      ],
    },
    { aborted: false, addEventListener() {}, removeEventListener() {} },
  );
  expect(report.outcomes[0]?.status).toBe("failed");
  expect(await h.isArchived("m1")).toBe(true);
  expect(await h.isArchived("m2")).toBe(true);
  expect(await h.isArchived("m3")).toBe(false);
  const logged = unwrap(await h.uow.reads.actionLog.listForAction(ws, unwrap(ActionId("act_1"))));
  expect(logged.map((e) => e.outcome)).toEqual(["pending", "applied", "failed"]);
  expect(logged[1]?.command.messageIds).toEqual(ids.slice(0, 2));
  expect(logged[1]?.inverse).toEqual({ kind: "unarchive", messageIds: ids.slice(0, 2) });

  const undo = new UndoAction(h);
  const undone = unwrap(
    await undo.execute(
      { workspaceId: ws, actionId: unwrap(ActionId("act_1")) },
      { aborted: false, addEventListener() {}, removeEventListener() {} },
    ),
  );
  expect(undone.outcomes[0]?.status).toBe("undone");
  expect(await h.isArchived("m1")).toBe(false);
  expect(await h.isArchived("m2")).toBe(false);
  expect(await h.isArchived("m3")).toBe(false);
});

authorizeContract(authorize, {
  categories: ["people", "promotions", "newsletters"],
  protectedCategories: ["people"],
});

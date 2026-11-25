import { ActionId } from "@pochimail/actions/ids";
import { createFakeClassifier } from "@pochimail/classification/testing/fake-ai";
import { unwrap } from "@pochimail/kernel/result";
import { createLogger } from "@pochimail/logger/logger";
import { createFakeTimer } from "@pochimail/testing/fake-timer";
import { makeActionLog } from "@pochimail/testing/fixtures";
import { expect, it } from "vitest";
import { createWorkerApp } from "./app.ts";
import { createFixtureAdapters } from "./fixture-adapters.ts";

// Guards: an action a crash left `pending` that is never settled, so it is missing from Activity and cannot be undone.
it("starting the worker settles an action a crash left pending (guards an undo that does not survive a crash)", async () => {
  const adapters = await createFixtureAdapters({
    scale: "small",
    timer: createFakeTimer(),
    logger: createLogger({ sink: { write: () => {} } }),
    deviceName: () => "Mac",
    classifier: createFakeClassifier(),
    newJobId: () => "job-1",
  });
  const { uow, workspaceId } = adapters;
  const account = unwrap(await uow.reads.accounts.list(workspaceId))[0];
  if (account === undefined) throw new Error("fixture has no account");
  const message = unwrap(
    await uow.reads.messages.query(workspaceId, { accountId: account.id, limit: 1 }),
  ).items[0];
  if (message === undefined) throw new Error("fixture has no message");
  const pending = makeActionLog(900, {
    workspaceId,
    actionId: unwrap(ActionId("act_crash")),
    outcome: "pending",
    command: { kind: "archive", messageIds: [message.id] },
    inverse: { kind: "unarchive", messageIds: [message.id] },
  });
  unwrap(await uow.run(async (tx) => tx.repositories.actionLog.append(pending)));

  const app = createWorkerApp(adapters);
  await app.idle();

  const logged = unwrap(await uow.reads.actionLog.listForKey(workspaceId, pending.idempotencyKey));
  expect(logged.map((e) => e.outcome)).toEqual(["pending", "applied"]);
  expect(logged[1]?.inverse).toMatchObject({ kind: "unarchive" });
});

import { ActionId } from "@pochimail/actions/ids";
import type { ActionLog } from "@pochimail/actions/model/action";
import { createFakeClassifier } from "@pochimail/classification/testing/fake-ai";
import { unwrap } from "@pochimail/kernel/result";
import { createLogger } from "@pochimail/logger/logger";
import { createFakeTimer } from "@pochimail/testing/fake-timer";
import { makeActionLog } from "@pochimail/testing/fixtures";
import { expect, it } from "vitest";
import { createWorkerApp } from "./app.ts";
import { createFixtureAdapters } from "./fixture-adapters.ts";

const start = async () => {
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
  const pending = (over: Partial<ActionLog>) =>
    makeActionLog(900, {
      workspaceId,
      actionId: unwrap(ActionId("act_crash")),
      outcome: "pending",
      at: new Date(adapters.clock.now().getTime() - 3_600_000).toISOString(),
      command: { kind: "archive", messageIds: [message.id] },
      inverse: { kind: "unarchive", messageIds: [message.id] },
      ...over,
    });
  return { adapters, uow, workspaceId, pending };
};

// Guards: an action a crash left `pending` that is never settled, so it is missing from Activity and cannot be undone.
it("starting the worker settles an action a crash left pending (guards an undo that does not survive a crash)", async () => {
  const { adapters, uow, workspaceId, pending: make } = await start();
  const pending = make({});
  unwrap(await uow.run(async (tx) => tx.repositories.actionLog.append(pending)));

  const app = createWorkerApp(adapters);
  await app.idle();

  const logged = unwrap(await uow.reads.actionLog.listForKey(workspaceId, pending.idempotencyKey));
  expect(logged.map((e) => e.outcome)).toEqual(["pending", "applied"]);
  expect(logged[1]?.inverse).toMatchObject({ kind: "unarchive" });
});

// Guards: recovery replaying an action the user started after the worker did, as ApplyAction is mid-flight.
it("recovery leaves an entry written after the worker started alone (guards a replay racing a running action)", async () => {
  const { adapters, uow, workspaceId, pending: make } = await start();
  const running = make({ at: new Date(adapters.clock.now().getTime() + 60_000).toISOString() });
  unwrap(await uow.run(async (tx) => tx.repositories.actionLog.append(running)));

  const app = createWorkerApp(adapters);
  await app.idle();

  const logged = unwrap(await uow.reads.actionLog.listForKey(workspaceId, running.idempotencyKey));
  expect(logged.map((e) => e.outcome)).toEqual(["pending"]);
});

import { StorageError } from "@pochimail/kernel/errors";
import type { TopicId, WorkspaceId } from "@pochimail/kernel/ids";
import { err, ok } from "@pochimail/kernel/result";
import { type Check, check, registerContract } from "@pochimail/kernel/testing/contract";
import type { OutboxEntry } from "@pochimail/pipeline/outbox";
import { expect } from "vitest";
import type { UnitOfWork } from "./uow-types.ts";

export interface UnitOfWorkHarness {
  readonly uow: UnitOfWork;
  /** Everything committed to the outbox so far, in order. */
  committedOutbox(): Promise<readonly OutboxEntry[]>;
}

/** Writes through a committed transaction, the only way rows get in. */
export async function writeThrough(
  h: UnitOfWorkHarness,
  work: (tx: Parameters<Parameters<UnitOfWork["run"]>[0]>[0]) => Promise<unknown>,
) {
  const r = await h.uow.run(async (tx) => {
    await work(tx);
    return ok(undefined);
  });
  expect(r.ok).toBe(true);
}

const ws = "w-1" as WorkspaceId;
const topic = { schemaVersion: 1 as const, id: "t-1" as TopicId, workspaceId: ws, name: "Trips" };
const entry: OutboxEntry = {
  kind: "job",
  workspaceId: ws,
  job: { type: "classify", payload: {}, idempotencyKey: "k-1" },
};

export const unitOfWorkChecks: readonly Check<UnitOfWorkHarness>[] = [
  check(
    "commits the row and its outbox entry together (guards events lost after a saved row)",
    async (h) => {
      const r = await h.uow.run(async (tx) => {
        await tx.repositories.topics.save(topic);
        await tx.outbox.append(entry);
        return ok("done");
      });
      expect(r).toEqual(ok("done"));
      expect(await h.uow.reads.topics.list(ws)).toEqual(ok([topic]));
      expect(await h.committedOutbox()).toEqual([entry]);
    },
  ),
  check(
    "rolls back the row and the outbox entry when work returns an Err (guards a phantom event for a failed write)",
    async (h) => {
      const failure = new StorageError("boom");
      const r = await h.uow.run(async (tx) => {
        await tx.repositories.topics.save(topic);
        await tx.outbox.append(entry);
        return err(failure);
      });
      expect(r).toEqual(err(failure));
      expect(await h.uow.reads.topics.list(ws)).toEqual(ok([]));
      expect(await h.committedOutbox()).toEqual([]);
    },
  ),
  check(
    "rolls back everything when work throws (guards a half-committed transaction after a bug)",
    async (h) => {
      await expect(
        h.uow.run(async (tx) => {
          await tx.repositories.topics.save(topic);
          await tx.outbox.append(entry);
          throw new Error("bug");
        }),
      ).rejects.toThrow("bug");
      expect(await h.uow.reads.topics.list(ws)).toEqual(ok([]));
      expect(await h.committedOutbox()).toEqual([]);
    },
  ),
  check(
    "does not commit when the signal is already aborted (guards work continuing after cancel)",
    async (h) => {
      const controller = new AbortController();
      controller.abort();
      const r = await h.uow.run(async (tx) => {
        await tx.repositories.topics.save(topic);
        return ok(1);
      }, controller.signal);
      expect(r.ok).toBe(false);
      expect(await h.uow.reads.topics.list(ws)).toEqual(ok([]));
    },
  ),
  check(
    "rolls back when the signal aborts mid-work (guards a cancelled scan leaving rows and events behind)",
    async (h) => {
      const controller = new AbortController();
      const r = await h.uow.run(async (tx) => {
        await tx.repositories.topics.save(topic);
        await tx.outbox.append(entry);
        controller.abort();
        return ok("finished anyway");
      }, controller.signal);
      expect(r.ok).toBe(false);
      expect(await h.uow.reads.topics.list(ws)).toEqual(ok([]));
      expect(await h.committedOutbox()).toEqual([]);
    },
  ),
  check(
    "keeps rows committed earlier when a later transaction rolls back (guards rollback wiping older data)",
    async (h) => {
      await h.uow.run(async (tx) => {
        await tx.repositories.topics.save(topic);
        return ok(1);
      });
      await h.uow.run(async (tx) => {
        await tx.repositories.topics.save({ ...topic, id: "t-2" as TopicId });
        return err(new StorageError("later failure"));
      });
      expect(await h.uow.reads.topics.list(ws)).toEqual(ok([topic]));
    },
  ),
];

/**
 * Contract for any `UnitOfWork` (in-memory, SQLite). Exported so M2 adapters reuse it unchanged.
 * `make` must return a fresh, empty store for each test.
 */
export function unitOfWorkContract(
  make: () => UnitOfWorkHarness | Promise<UnitOfWorkHarness>,
): void {
  registerContract("UnitOfWork contract", unitOfWorkChecks, make);
}

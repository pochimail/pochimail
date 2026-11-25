import type { Clock } from "@pochimail/kernel/clock";
import type { CancelSignal } from "@pochimail/kernel/common";
import { Cancelled, StorageError } from "@pochimail/kernel/errors";
import type { EventEnvelope } from "@pochimail/kernel/event";
import { err, ok, type Result } from "@pochimail/kernel/result";
import { workspaceIdSchema } from "@pochimail/kernel/schemas";
import type { JobRequest } from "@pochimail/pipeline/job-queue";
import type { OutboxEntry, OutboxRecord, OutboxStore } from "@pochimail/pipeline/outbox";
import { eventSinkOver } from "@pochimail/pipeline/outbox-event-sink";
import { z } from "zod";
import { DisplayFieldsCache } from "./mailbox/display-fields-cache.ts";
import { exclusiveResult, type Storage } from "./open-storage.ts";
import { accountIdOf, guardPayload } from "./payload-guard.ts";
import { createSqliteRepositories } from "./sqlite-repositories.ts";
import type { Transaction, UnitOfWork } from "./unit-of-work-types.ts";

// Rows are parsed at the boundary. Events are loosely typed on purpose: the catalog (core) owns
// their shape, this adapter only has to give back what it was given.
const eventPayload = z.looseObject({
  id: z.string(),
  type: z.string(),
  workspaceId: workspaceIdSchema,
});
const jobPayload = z.object({
  workspaceId: workspaceIdSchema,
  job: z.object({
    type: z.string(),
    payload: z.unknown(),
    idempotencyKey: z.string(),
    runAt: z.string().optional(),
  }),
});
const outboxRow = z.object({
  seq: z.number(),
  kind: z.enum(["event", "job"]),
  payload: z.string(),
});

function parseEntry(kind: "event" | "job", payload: string): OutboxEntry {
  const json: unknown = JSON.parse(payload);
  if (kind === "event") return { kind, event: eventPayload.parse(json) as EventEnvelope };
  const parsed = jobPayload.parse(json);
  const job: JobRequest = {
    type: parsed.job.type,
    payload: parsed.job.payload,
    idempotencyKey: parsed.job.idempotencyKey,
    ...(parsed.job.runAt === undefined ? {} : { runAt: parsed.job.runAt }),
  };
  return { kind, workspaceId: parsed.workspaceId, job };
}

export interface SqliteUnitOfWork {
  readonly uow: UnitOfWork;
  /** The relay's view: undelivered rows in append order, and marking them delivered. */
  readonly outboxStore: OutboxStore;
}

/**
 * `UnitOfWork` over the single writer connection. Work runs inside `BEGIN IMMEDIATE … COMMIT`:
 * `ok` commits repository writes and outbox appends together; `err`, a throw, or an aborted
 * signal rolls all of them back. Reads outside a transaction use the read-only connection, so
 * they never see uncommitted rows. Transactions run one at a time.
 */
export function createSqliteUnitOfWork(
  storage: Storage,
  clock: Clock = { now: () => new Date() },
): SqliteUnitOfWork {
  // One cache for this unit of work: a write and the reads that follow it see the same private
  // fields, while a new unit of work after a restart sees none (ADR 0014).
  const cache = new DisplayFieldsCache();
  const context = { cache, senderHasher: storage.senderHasher };
  const read = createSqliteRepositories(storage.reader, context).reads;
  const writeSide = createSqliteRepositories(storage.writer, context);
  const write = writeSide.writes;
  const insertOutbox = storage.writer.prepare(
    "INSERT INTO outbox (kind, workspace_id, payload, account_id) VALUES (?, ?, ?, ?)",
  );

  const outbox: Transaction["outbox"] = {
    async append(entry) {
      try {
        const guarded = guardPayload(
          entry.kind === "event" ? entry.event : { workspaceId: entry.workspaceId, job: entry.job },
        );
        if (!guarded.ok) return guarded;
        insertOutbox.run(
          entry.kind,
          entry.kind === "event" ? entry.event.workspaceId : entry.workspaceId,
          guarded.value,
          accountIdOf(
            entry.kind === "event"
              ? (entry.event as { payload?: unknown }).payload
              : entry.job.payload,
          ),
        );
        return ok(undefined);
      } catch (cause) {
        return err(new StorageError("Could not append to the outbox", { cause }));
      }
    },
  };
  const tx: Transaction = {
    repositories: write,
    keepRules: writeSide.keepRules,
    outbox,
    events: eventSinkOver(outbox),
  };

  const uow: UnitOfWork = {
    reads: read,
    run: <T, E>(work: (tx: Transaction) => Promise<Result<T, E>>, signal?: CancelSignal) =>
      exclusiveResult<T, E | StorageError | Cancelled>(storage, async () => {
        if (signal?.aborted) return err(new Cancelled());
        storage.writer.exec("BEGIN IMMEDIATE");
        try {
          const outcome = await work(tx);
          if (signal?.aborted) {
            storage.writer.exec("ROLLBACK");
            return err(new Cancelled());
          }
          if (!outcome.ok) {
            storage.writer.exec("ROLLBACK");
            return outcome;
          }
          try {
            storage.writer.exec("COMMIT");
          } catch (cause) {
            // A failed COMMIT (disk full, I/O) is an expected storage failure, not a bug.
            if (storage.writer.inTransaction) storage.writer.exec("ROLLBACK");
            return err(new StorageError("Could not commit the transaction", { cause }));
          }
          return outcome;
        } catch (error) {
          if (storage.writer.inTransaction) storage.writer.exec("ROLLBACK");
          throw error;
        }
      }),
  };

  const outboxStore: OutboxStore = {
    async pending(limit) {
      try {
        const rows = storage.reader
          .prepare(
            "SELECT seq, kind, payload FROM outbox WHERE delivered_at IS NULL ORDER BY seq LIMIT ?",
          )
          .all(limit)
          .map((row) => outboxRow.parse(row));
        const records: OutboxRecord[] = rows.map((r) => ({
          id: String(r.seq),
          entry: parseEntry(r.kind, r.payload),
        }));
        return ok(records);
      } catch (cause) {
        return err(new StorageError("Could not read the outbox", { cause }));
      }
    },
    markDelivered: (id) =>
      exclusiveResult(storage, async () => {
        try {
          storage.writer
            .prepare("UPDATE outbox SET delivered_at = ? WHERE seq = ? AND delivered_at IS NULL")
            .run(clock.now().toISOString(), Number(id));
          return ok(undefined);
        } catch (cause) {
          return err(new StorageError("Could not mark the outbox row delivered", { cause }));
        }
      }),
  };

  return { uow, outboxStore };
}

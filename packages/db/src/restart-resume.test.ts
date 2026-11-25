import type { Classifier } from "@pochimail/classification/ports/classifier";
import { createFakeClassifier } from "@pochimail/classification/testing/fake-ai";
import { Offline, RateLimited } from "@pochimail/kernel/errors";
import { ok, unwrap } from "@pochimail/kernel/result";
import { createOutboxRelay } from "@pochimail/pipeline/outbox-relay";
import { createPowerLimiter } from "@pochimail/pipeline/power-limiter";
import type { PowerMonitor } from "@pochimail/pipeline/power-monitor";
import { createFakeClock } from "@pochimail/testing/fake-clock";
import { createFakeMailProvider } from "@pochimail/testing/fake-mail-provider";
import { createFakePowerMonitor } from "@pochimail/testing/fake-power-monitor";
import { ACCOUNT_1, makeAccount, makeIncomingMessage, WS_A } from "@pochimail/testing/fixtures";
import { CLASSIFY_LIMITS, limitClassifier } from "@pochimail/workflows/jobs/limit-classifier";
import { scanCursorCodec } from "@pochimail/workflows/jobs/scan-pipeline";
import { ClassifyPending } from "@pochimail/workflows/use-cases/classify-pending";
import { RunIncrementalSync } from "@pochimail/workflows/use-cases/run-incremental-sync";
import { RunScan } from "@pochimail/workflows/use-cases/run-scan";
import { describe, expect, it } from "vitest";
import { createSqliteJobQueue } from "./sqlite-job-queue.ts";
import { createSqliteUnitOfWork } from "./sqlite-unit-of-work.ts";
import { freshPath, open } from "./test-support/storage.ts";

/** What a hard stop leaves behind: the process is gone, the file stays. */
class HardStop extends Error {}

const succeeded = (outcome: "stopped" | { readonly ok: boolean }) =>
  outcome !== "stopped" && outcome.ok;

type StopPoint = "after-sync-before-classify" | "mid-batch" | "after-outbox-write";
const STOP_POINTS: readonly StopPoint[] = [
  "after-sync-before-classify",
  "mid-batch",
  "after-outbox-write",
];

const never = new AbortController().signal;

/** Seven messages in four pages of two: enough batch boundaries to stop between. */
const provider = () => {
  const fake = createFakeMailProvider({ pageSize: 2 });
  for (let n = 1; n <= 7; n += 1)
    fake.deliver(makeIncomingMessage(n, { hasListUnsubscribe: n % 3 === 0 }));
  return fake;
};

/** One process lifetime over the database file: opens it, delivers what a crash left undelivered, scans. */
async function launch(
  path: string,
  mail: ReturnType<typeof provider>,
  delivered: string[],
  power?: PowerMonitor,
) {
  const storage = open(path);
  const clock = createFakeClock();
  const { uow, outboxStore } = createSqliteUnitOfWork(storage, clock);
  const queue = createSqliteJobQueue(storage, clock);
  const relay = createOutboxRelay({
    store: outboxStore,
    queue,
    bus: {
      publish: async (event) => {
        delivered.push(event.id);
        return ok(undefined);
      },
      subscribe: () => () => {},
    },
  });
  let stopped = false;
  const stop = (): never => {
    stopped = true;
    storage.close();
    throw new HardStop();
  };
  return {
    storage,
    async scan(jobId: string, stopAt?: { point: StopPoint; batch: number }) {
      const classifier = createFakeClassifier();
      let batches = 0;
      let flushes = 0;
      const inner = classifier.classify;
      // With a power monitor the scan is wired as the worker wires it: several batches in flight on mains.
      const limiter = power && createPowerLimiter(power, CLASSIFY_LIMITS);
      const stopping: Classifier = {
        async classify(messages, signal) {
          batches += 1;
          const here = stopAt?.batch === batches;
          if (here && stopAt.point === "after-sync-before-classify") stop();
          const classified = await inner(messages, signal);
          if (here && stopAt.point === "mid-batch") stop();
          return classified;
        },
      };
      const run = new RunScan({
        uow,
        provider: mail,
        classifier: limiter ? limitClassifier(stopping, limiter) : stopping,
        clock,
        queue,
        random: () => 0.5,
        workspaceId: WS_A,
        accountId: ACCOUNT_1,
        maxInFlightBatches: limiter ? CLASSIFY_LIMITS.plugged : 1,
        ...(limiter ? { classifyConcurrency: CLASSIFY_LIMITS.plugged } : {}),
        flush: async () => {
          flushes += 1;
          if (stopAt?.point === "after-outbox-write" && stopAt.batch === flushes) stop();
          await relay.drain();
        },
      });
      // After the stop the process is gone: whatever its failure handling then throws is not a result.
      return run.execute({ jobId }, never).catch((error: unknown) => {
        if (!stopped && !(error instanceof HardStop)) throw error;
        return "stopped" as const;
      });
    },
    /** The sync after the first scan: store what arrived, then classify it and what is left; a stop can fall between. */
    async sync(stopBeforeClassify = false) {
      const inner = createFakeClassifier().classify;
      const classifier: Classifier = {
        classify: async (messages, signal) => {
          if (stopBeforeClassify) stop();
          return inner(messages, signal);
        },
      };
      try {
        const stored = await new RunIncrementalSync({
          uow,
          provider: mail,
          clock,
          cursorCodec: scanCursorCodec,
        }).execute({ workspaceId: WS_A, accountId: ACCOUNT_1 }, never);
        const classified = await new ClassifyPending({
          uow,
          classifier,
          clock,
          workspaceId: WS_A,
          accountId: ACCOUNT_1,
        }).execute(never);
        await relay.drain();
        return stored.ok && classified.ok ? ("done" as const) : ("failed" as const);
      } catch (error) {
        if (!stopped && !(error instanceof HardStop)) throw error;
        return "stopped" as const;
      }
    },
    drain: () => relay.drain(),
    close: () => storage.close(),
  };
}

type Launched = Awaited<ReturnType<typeof launch>>;

const seededPath = async () => {
  const path = freshPath();
  const first = open(path);
  const { uow } = createSqliteUnitOfWork(first);
  unwrap(await uow.run((tx) => tx.repositories.accounts.save(makeAccount())));
  first.close();
  return path;
};

/** Every table but the delivery bookkeeping, rows in a stable order. */
const dump = (storage: Launched["storage"]) => {
  const tables = storage.reader
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('outbox', 'job') ORDER BY name",
    )
    .all() as { name: string }[];
  return tables.map(({ name }) => ({
    name,
    rows: (storage.reader.prepare(`SELECT * FROM "${name}"`).all() as object[])
      .map((row) => JSON.stringify(row))
      .sort(),
  }));
};

const committedEventIds = (storage: Launched["storage"]) =>
  (
    storage.reader.prepare("SELECT payload FROM outbox WHERE kind = 'event'").all() as {
      payload: string;
    }[]
  )
    .map((row) => (JSON.parse(row.payload) as { id: string }).id)
    .sort();

/** What an uninterrupted run leaves: the reference every interrupted run must equal. */
const uninterrupted = async () => {
  const path = await seededPath();
  const run = await launch(path, provider(), []);
  expect(succeeded(await run.scan("job-1"))).toBe(true);
  const state = dump(run.storage);
  run.close();
  return state;
};

const expectEventsOnce = (storage: Launched["storage"], delivered: string[]) => {
  // Each committed row goes out once. A replayed batch commits the same event id again by design
  // (ADR 0003: handlers dedupe on the id), so rows are compared, not distinct ids.
  expect([...delivered].sort()).toEqual(committedEventIds(storage));
  // The scan's own milestones are never repeated: it completes once, and only replayed batches repeat an id.
  expect(delivered.filter((id) => id.endsWith(":done"))).toHaveLength(1);
  const repeated = delivered.filter((id, at) => delivered.indexOf(id) !== at);
  expect(repeated.filter((id) => id.startsWith("scan:"))).toEqual([]);
};

describe("restart and resume on SQLite", () => {
  for (const point of STOP_POINTS) {
    it(`a hard stop ${point.replaceAll("-", " ")} ends in the same database as an uninterrupted run, and no event is lost or delivered twice`, async () => {
      // Guards: a stop that loses mail, repeats a batch's effects, or drops or doubles an event.
      const reference = await uninterrupted();
      const path = await seededPath();
      const mail = provider();
      const delivered: string[] = [];

      const before = await launch(path, mail, delivered);
      expect(await before.scan("job-1", { point, batch: 2 })).toBe("stopped");

      const after = await launch(path, mail, delivered);
      unwrap(await after.drain());
      expect(succeeded(await after.scan("job-2"))).toBe(true);
      expect(dump(after.storage)).toEqual(reference);
      expectEventsOnce(after.storage, delivered);
      expect(unwrap(await after.drain()).delivered).toBe(0);
    });
  }

  for (const point of STOP_POINTS) {
    it(`a hard stop ${point.replaceAll("-", " ")} with several batches in flight, reopened on battery, ends in the same database with no doubled milestone`, async () => {
      // Guards: the power-aware classify pipeline losing or repeating a batch when it stops mid-batch and resumes at another limit.
      const reference = await uninterrupted();
      const path = await seededPath();
      const mail = provider();
      const delivered: string[] = [];

      const before = await launch(path, mail, delivered, createFakePowerMonitor());
      expect(await before.scan("job-1", { point, batch: 2 })).toBe("stopped");

      const after = await launch(
        path,
        mail,
        delivered,
        createFakePowerMonitor({ onBattery: true }),
      );
      unwrap(await after.drain());
      expect(succeeded(await after.scan("job-2"))).toBe(true);
      expect(dump(after.storage)).toEqual(reference);
      expectEventsOnce(after.storage, delivered);
    });
  }

  /** Mail that reaches the provider after the first scan. */
  const deliverMore = (mail: ReturnType<typeof provider>) => {
    for (const n of [8, 9, 10])
      mail.deliver(makeIncomingMessage(n, { hasListUnsubscribe: n % 2 === 0 }));
  };

  it("a hard stop between the sync and the classify of mail that arrived after the first scan ends with it classified exactly once, like an uninterrupted run", async () => {
    // Guards: mail stored by an incremental sync that stays unclassified after a crash, or is classified twice.
    const referenceMail = provider();
    const referencePath = await seededPath();
    const reference = await launch(referencePath, referenceMail, []);
    expect(succeeded(await reference.scan("job-1"))).toBe(true);
    deliverMore(referenceMail);
    expect(await reference.sync()).toBe("done");
    const expected = dump(reference.storage);
    reference.close();

    const path = await seededPath();
    const mail = provider();
    const delivered: string[] = [];
    const first = await launch(path, mail, delivered);
    expect(succeeded(await first.scan("job-1"))).toBe(true);
    deliverMore(mail);
    expect(await first.sync(true)).toBe("stopped");

    const after = await launch(path, mail, delivered);
    unwrap(await after.drain());
    expect(await after.sync()).toBe("done");
    expect(dump(after.storage)).toEqual(expected);
    expectEventsOnce(after.storage, delivered);
    const classifiedEvents = delivered.filter((id) => /^classified:msg-(8|9|10):/.test(id));
    expect(classifiedEvents).toHaveLength(3);
    expect(new Set(classifiedEvents).size).toBe(3);
  });

  const outages = [
    { name: "rate-limited", failure: () => new RateLimited({ retryAfterMs: 60_000 }) },
    { name: "offline", failure: () => new Offline() },
  ] as const;
  for (const { name, failure } of outages) {
    it(`a stop followed by a ${name} interval resumes by itself into the same database as an uninterrupted run`, async () => {
      // Guards: an outage after a restart that strands the scan, or resumes from the wrong cursor.
      const reference = await uninterrupted();
      const path = await seededPath();
      const mail = provider();
      const delivered: string[] = [];

      const first = await launch(path, mail, delivered);
      expect(await first.scan("job-1", { point: "mid-batch", batch: 2 })).toBe("stopped");

      mail.faults.failWith(failure(), { times: 1 });
      const second = await launch(path, mail, delivered);
      unwrap(await second.drain());
      expect(succeeded(await second.scan("job-2"))).toBe(false);
      second.close();

      // The next attempt needs no manual step: the provider is reachable again.
      const third = await launch(path, mail, delivered);
      unwrap(await third.drain());
      expect(succeeded(await third.scan("job-3"))).toBe(true);
      expect(dump(third.storage)).toEqual(reference);
      expectEventsOnce(third.storage, delivered);
    });
  }
});

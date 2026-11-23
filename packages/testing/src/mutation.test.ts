import { failingChecks } from "@pochimail/kernel/testing/contract";
import { describe, expect, it } from "vitest";
import { createFakeClock } from "./fake-clock.ts";
import { createFakeWindowActivity } from "./fake-window-activity.ts";
import { createInMemoryJobQueue } from "./in-memory-job-queue.ts";
import { createFakeScheduler } from "./in-memory-scheduler.ts";
import { createInMemoryUnitOfWork } from "./in-memory-store.ts";
import { jobQueueChecks } from "./job-queue-contract.ts";
import { repositoriesChecks } from "./repositories-contract.ts";
import { schedulerChecks } from "./scheduler-contract.ts";
import { unitOfWorkChecks } from "./unit-of-work-contract.ts";
import type { UnitOfWork } from "./uow-types.ts";
import { windowActivityChecks } from "./window-activity-contract.ts";

const noopStop = (_real: () => void) => () => {};

// Named mutation tests: each deliberately broken adapter must fail the contract that guards it.
describe("contract suites catch broken adapters", () => {
  /** Repository that loses every earlier write when a transaction rolls back. */
  function lossyRollbackUnitOfWork() {
    let inner = createInMemoryUnitOfWork();
    const uow: UnitOfWork = {
      reads: new Proxy({} as UnitOfWork["reads"], {
        get: (_t, k) => inner.uow.reads[k as keyof UnitOfWork["reads"]],
      }),
      async run(work, signal) {
        const r = await inner.uow.run(work, signal);
        if (!r.ok) inner = createInMemoryUnitOfWork();
        return r;
      },
    };
    return { uow, committedOutbox: () => inner.committedOutbox() };
  }

  /** Commits even when the work returns an Err. */
  function commitsOnErrUnitOfWork() {
    const inner = createInMemoryUnitOfWork();
    const uow: UnitOfWork = {
      reads: inner.uow.reads,
      run: (work, signal) =>
        inner.uow.run(async (tx) => {
          const r = await work(tx);
          return r.ok
            ? r
            : (Object.assign({ ok: true, value: undefined }, { original: r }) as never);
        }, signal),
    };
    return { uow, committedOutbox: () => inner.committedOutbox() };
  }

  it("a repository that loses writes on rollback fails the UnitOfWork suite", async () => {
    const failed = await failingChecks(unitOfWorkChecks, lossyRollbackUnitOfWork);
    expect(failed.some((n) => n.includes("keeps rows committed earlier"))).toBe(true);
  });

  it("a UnitOfWork that commits on Err fails the UnitOfWork suite", async () => {
    const failed = await failingChecks(unitOfWorkChecks, commitsOnErrUnitOfWork);
    expect(failed.some((n) => n.includes("phantom event"))).toBe(true);
  });

  it("the correct in-memory unit of work passes both suites (guards mutation tests that fail for the wrong reason)", async () => {
    expect(await failingChecks(unitOfWorkChecks, createInMemoryUnitOfWork)).toEqual([]);
    expect(await failingChecks(repositoriesChecks, createInMemoryUnitOfWork)).toEqual([]);
  });

  it("a job queue that hands a claimed job out twice fails the JobQueue suite", async () => {
    const broken = () => {
      const clock = createFakeClock();
      const real = createInMemoryJobQueue(clock);
      return {
        clock,
        queue: {
          ...real,
          claim: async (types: readonly string[], signal: Parameters<typeof real.claim>[1]) => {
            const r = await real.claim(types, signal);
            if (r.ok && r.value)
              await real.fail(r.value.id, "storage.failed", clock.now().toISOString());
            return r;
          },
        },
      };
    };
    const failed = await failingChecks(jobQueueChecks, broken);
    expect(failed.some((n) => n.includes("not handed out again"))).toBe(true);
  });

  it("a scheduler whose unsubscribe does nothing fails the Scheduler suite", async () => {
    const broken = () => {
      const real = createFakeScheduler(createFakeClock());
      return {
        advance: (ms: number) => real.advance(ms),
        scheduler: {
          after: (d: number, t: Parameters<typeof real.after>[1]) => noopStop(real.after(d, t)),
          every: (i: number, t: Parameters<typeof real.every>[1]) => noopStop(real.every(i, t)),
        },
      };
    };
    const failed = await failingChecks(schedulerChecks, broken);
    expect(failed.some((n) => n.includes("unsubscribe stops further runs"))).toBe(true);
  });

  it("a window activity whose unsubscribe does nothing fails the WindowActivity suite", async () => {
    const broken = () => {
      const real = createFakeWindowActivity();
      return {
        activity: {
          current: () => real.current(),
          onChange: (l: Parameters<typeof real.onChange>[0]) => noopStop(real.onChange(l)),
        },
        change: (s: Parameters<typeof real.set>[0]) => real.set(s),
      };
    };
    const failed = await failingChecks(windowActivityChecks, broken);
    expect(failed.some((n) => n.includes("unsubscribe stops notifications"))).toBe(true);
  });
});

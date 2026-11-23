import { createInMemorySecretStore } from "@pochimail/accounts/testing/in-memory-secret-store";
import { secretStoreContract } from "@pochimail/accounts/testing/secret-store-contract";
import { Offline, RateLimited, StorageError } from "@pochimail/kernel/errors";
import type { WorkspaceId } from "@pochimail/kernel/ids";
import { ok } from "@pochimail/kernel/result";
import { describe, expect, it } from "vitest";
import { createFakeClock } from "./fake-clock.ts";
import { createFakeMailProvider } from "./fake-mail-provider.ts";
import { createFakePowerMonitor } from "./fake-power-monitor.ts";
import { createFakeWindowActivity } from "./fake-window-activity.ts";
import { createInMemoryJobQueue } from "./in-memory-job-queue.ts";
import { createInMemoryNotifier } from "./in-memory-notifier.ts";
import { createFakeScheduler } from "./in-memory-scheduler.ts";
import { createInMemoryUnitOfWork } from "./in-memory-store.ts";
import { jobQueueContract } from "./job-queue-contract.ts";
import { mailProviderContract } from "./mail-provider-contract.ts";
import { notifierContract } from "./notifier-contract.ts";
import { powerMonitorContract } from "./power-monitor-contract.ts";
import { repositoriesContract } from "./repositories-contract.ts";
import { schedulerContract } from "./scheduler-contract.ts";
import { unitOfWorkContract } from "./unit-of-work-contract.ts";
import { windowActivityContract } from "./window-activity-contract.ts";

// Every in-memory adapter must pass its own contract suite.
unitOfWorkContract(createInMemoryUnitOfWork);
repositoriesContract(createInMemoryUnitOfWork);
secretStoreContract(createInMemorySecretStore);
jobQueueContract(() => {
  const clock = createFakeClock();
  return { queue: createInMemoryJobQueue(clock), clock };
});
schedulerContract(() => {
  const scheduler = createFakeScheduler(createFakeClock());
  return { scheduler, advance: (ms) => scheduler.advance(ms) };
});
notifierContract(() => {
  const notifier = createInMemoryNotifier();
  return { notifier, shown: () => notifier.sent() };
});
powerMonitorContract(() => {
  const monitor = createFakePowerMonitor();
  return { monitor, change: (c) => monitor.set(c) };
});
windowActivityContract(() => {
  const activity = createFakeWindowActivity();
  return { activity, change: (s) => activity.set(s) };
});
mailProviderContract(() => {
  const provider = createFakeMailProvider({ pageSize: 2 });
  return { provider, deliver: (...m) => provider.deliver(...m) };
});

describe("controllable fakes", () => {
  const live = () => new AbortController().signal;

  it("the mail provider fails with Offline on demand and recovers (guards untested offline handling)", async () => {
    const provider = createFakeMailProvider();
    provider.simulateOffline();
    const r = await provider.sync(null, live());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBeInstanceOf(Offline);
    provider.faults.clear();
    expect((await provider.sync(null, live())).ok).toBe(true);
  });

  it("the mail provider fails with RateLimited and its retry-after on demand (guards untested backoff)", async () => {
    const provider = createFakeMailProvider();
    provider.simulateRateLimit(2500);
    const r = await provider.applyCommands([], live());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBeInstanceOf(RateLimited);
      expect((r.error as RateLimited).retryAfterMs).toBe(2500);
    }
  });

  it("a fault with times: 1 fails one call and then clears itself (guards tests that must retry once)", async () => {
    const provider = createFakeMailProvider();
    provider.faults.failWith(new Offline(), { times: 1 });
    expect((await provider.sync(null, live())).ok).toBe(false);
    expect((await provider.sync(null, live())).ok).toBe(true);
  });

  it("a forced storage failure inside a transaction leaves no rows or events (guards partial writes under failure)", async () => {
    const store = createInMemoryUnitOfWork();
    const ws = "ws-1" as WorkspaceId;
    const r = await store.uow.run(async (tx) => {
      const saved = await tx.repositories.topics.save({
        schemaVersion: 1,
        id: "t-1" as never,
        workspaceId: ws,
        name: "Trips",
      });
      expect(saved.ok).toBe(true);
      store.faults.failWith(new StorageError("disk full"), { times: 1 });
      return tx.outbox.append({ kind: "event", event: { id: "e1", type: "x", workspaceId: ws } });
    });
    expect(r.ok).toBe(false);
    expect(await store.uow.reads.topics.list(ws)).toEqual(ok([]));
    expect(await store.committedOutbox()).toEqual([]);
  });

  it("a fake scheduler runs nothing until time is advanced (guards flaky sleep-based tests)", async () => {
    const clock = createFakeClock();
    const scheduler = createFakeScheduler(clock);
    let ran = false;
    scheduler.after(60_000, async () => {
      ran = true;
    });
    expect(ran).toBe(false);
    await scheduler.advance(60_000);
    expect(ran).toBe(true);
    expect(clock.now().getTime() - new Date("2026-01-01T00:00:00.000Z").getTime()).toBe(60_000);
  });

  it("the power monitor tells listeners about going offline (guards ignoring the offline state)", () => {
    const monitor = createFakePowerMonitor();
    const seen: boolean[] = [];
    monitor.onChange((s) => void seen.push(s.online));
    monitor.goOffline();
    monitor.goOffline();
    expect(seen).toEqual([false]);
  });
});

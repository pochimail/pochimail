import type { CancelSignal } from "@pochimail/kernel/common";
import { FOCUSED_POLL_MS, VISIBLE_POLL_MS } from "@pochimail/mailbox/policies/poll-cadence";
import { createAdaptivePolling } from "@pochimail/pipeline/adaptive-polling";
import type { PowerState } from "@pochimail/pipeline/power-monitor";
import type { WindowActivityState } from "@pochimail/pipeline/window-activity";
import { describe, expect, it } from "vitest";
import { createFakeClock } from "./fake-clock.ts";
import { createFakePowerMonitor, type FakePowerMonitor } from "./fake-power-monitor.ts";
import { createFakeWindowActivity } from "./fake-window-activity.ts";
import { createFakeScheduler } from "./in-memory-scheduler.ts";

const HIDDEN_MS = 3_600_000;

function harness(
  opts: {
    activity?: WindowActivityState;
    power?: Partial<PowerState>;
    hiddenMs?: number | null;
  } = {},
) {
  const scheduler = createFakeScheduler(createFakeClock());
  const power = createFakePowerMonitor(opts.power);
  const activity = createFakeWindowActivity(opts.activity ?? "focused");
  const polling = createAdaptivePolling({
    scheduler,
    power,
    activity,
    cadence: {
      focusedMs: FOCUSED_POLL_MS,
      visibleMs: VISIBLE_POLL_MS,
      hiddenMs: opts.hiddenMs === undefined ? HIDDEN_MS : opts.hiddenMs,
    },
  });
  return { scheduler, power, activity, polling };
}

/** A poll that blocks until the test releases it, and reports when the task body finished. */
function blockedTask() {
  let release: () => void = () => {};
  let finished: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const done = new Promise<void>((r) => {
    finished = r;
  });
  return { gate, done, release: () => release(), finished: () => finished() };
}

async function expectPauseResume(
  pause: (power: FakePowerMonitor) => void,
  resume: (power: FakePowerMonitor) => void,
) {
  const { scheduler, power, polling } = harness();
  let runs = 0;
  polling.watch("acc-1", async () => {
    runs++;
  });
  await scheduler.advance(FOCUSED_POLL_MS);
  expect(runs).toBe(1);
  pause(power);
  await scheduler.advance(5 * FOCUSED_POLL_MS);
  expect(runs).toBe(1);
  resume(power);
  await scheduler.advance(1);
  expect(runs).toBe(1);
  await scheduler.advance(FOCUSED_POLL_MS - 1);
  expect(runs).toBe(2);
  pause(power);
  resume(power);
  pause(power);
  resume(power);
  await scheduler.advance(FOCUSED_POLL_MS);
  expect(runs).toBe(3);
}

describe("adaptive polling cadence", () => {
  // Guards: polling slower or faster than about 1 min while the window is focused.
  it("polls about every minute while focused", async () => {
    const { scheduler, polling } = harness();
    let runs = 0;
    polling.watch("acc-1", async () => {
      runs++;
    });
    await scheduler.advance(FOCUSED_POLL_MS - 1);
    expect(runs).toBe(0);
    await scheduler.advance(1);
    expect(runs).toBe(1);
    await scheduler.advance(FOCUSED_POLL_MS);
    expect(runs).toBe(2);
  });

  // Guards: polling at the focused cadence while the window is only visible, wasting battery and quota.
  it("polls about every 5 min while visible and idle", async () => {
    const { scheduler, polling } = harness({ activity: "visible" });
    let runs = 0;
    polling.watch("acc-1", async () => {
      runs++;
    });
    await scheduler.advance(FOCUSED_POLL_MS);
    expect(runs).toBe(0);
    await scheduler.advance(VISIBLE_POLL_MS - FOCUSED_POLL_MS);
    expect(runs).toBe(1);
  });

  // Guards: polling at the visible cadence while hidden, instead of the Keep it tidy cadence.
  it("polls on the injected hidden cadence while hidden", async () => {
    const { scheduler, polling } = harness({ activity: "hidden", hiddenMs: HIDDEN_MS });
    let runs = 0;
    polling.watch("acc-1", async () => {
      runs++;
    });
    await scheduler.advance(VISIBLE_POLL_MS);
    expect(runs).toBe(0);
    await scheduler.advance(HIDDEN_MS - VISIBLE_POLL_MS);
    expect(runs).toBe(1);
  });

  // Guards: automatic polls while hidden on the on-request tidy choice, or a manual refresh ignored there.
  it("never polls automatically while hidden on request, but a trigger still polls", async () => {
    const { scheduler, polling } = harness({ activity: "hidden", hiddenMs: null });
    let runs = 0;
    polling.watch("acc-1", async () => {
      runs++;
    });
    await scheduler.advance(2 * VISIBLE_POLL_MS);
    expect(runs).toBe(0);
    polling.trigger("acc-1");
    expect(runs).toBe(1);
  });

  // Guards: keeping the old cadence after the window state changes, so polls come too often or too rarely.
  it("re-arms the cadence when the activity state changes", async () => {
    const { scheduler, activity, polling } = harness();
    let runs = 0;
    polling.watch("acc-1", async () => {
      runs++;
    });
    await scheduler.advance(FOCUSED_POLL_MS / 2);
    expect(runs).toBe(0);
    activity.set("visible");
    await scheduler.advance(FOCUSED_POLL_MS);
    expect(runs).toBe(0);
    await scheduler.advance(VISIBLE_POLL_MS - FOCUSED_POLL_MS);
    expect(runs).toBe(1);
  });
});

describe("adaptive polling pauses", () => {
  // Guards: polling while the machine sleeps, and a doubled or missing resume on wake.
  it("pauses on sleep and resumes once on wake", async () => {
    await expectPauseResume(
      (p) => p.sleep(),
      (p) => p.wake(),
    );
  });

  // Guards: polling while offline, and a doubled or missing resume once back online.
  it("pauses offline and resumes once online", async () => {
    await expectPauseResume(
      (p) => p.goOffline(),
      (p) => p.goOnline(),
    );
  });

  // Guards: polling in battery saver, and a doubled or missing resume once it is off.
  it("pauses in battery saver and resumes once it is off", async () => {
    await expectPauseResume(
      (p) => p.set({ batterySaver: true }),
      (p) => p.set({ batterySaver: false }),
    );
  });

  // Guards: a sync keeps running through sleep or offline, wasting battery and failing on the network.
  it("aborts an in-flight poll when pausing", async () => {
    const { scheduler, power, polling } = harness();
    const { gate, done, release, finished } = blockedTask();
    let runs = 0;
    let aborted = false;
    polling.watch("acc-1", async (signal) => {
      runs++;
      signal.addEventListener(
        "abort",
        () => {
          aborted = true;
        },
        { once: true },
      );
      await gate;
      finished();
    });
    polling.trigger("acc-1");
    expect(runs).toBe(1);
    power.sleep();
    expect(aborted).toBe(true);
    release();
    await done;
    await Promise.resolve();
    power.wake();
    await scheduler.advance(FOCUSED_POLL_MS);
    expect(runs).toBe(2);
  });
});

describe("adaptive polling single flight", () => {
  // Guards: a second sync starting while one is running, doubling provider calls and cursor writes.
  it("overlapping triggers and ticks produce one run, and a cadence change never aborts it", async () => {
    const { scheduler, activity, polling } = harness();
    const { gate, done, release, finished } = blockedTask();
    let runs = 0;
    const captured: { signal: CancelSignal | null } = { signal: null };
    polling.watch("acc-1", async (signal) => {
      runs++;
      if (runs === 1) {
        captured.signal = signal;
        await gate;
        finished();
      }
    });
    polling.trigger("acc-1");
    polling.trigger("acc-1");
    await scheduler.advance(FOCUSED_POLL_MS);
    expect(runs).toBe(1);
    activity.set("visible");
    expect(captured.signal?.aborted).toBe(false);
    release();
    await done;
    await Promise.resolve();
    await scheduler.advance(VISIBLE_POLL_MS);
    expect(runs).toBe(2);
  });

  // Guards: one account's poll blocking or standing in for another's.
  it("polls each account on its own", async () => {
    const { scheduler, polling } = harness();
    let first = 0;
    let second = 0;
    polling.watch("acc-1", async () => {
      first++;
    });
    polling.watch("acc-2", async () => {
      second++;
    });
    await scheduler.advance(FOCUSED_POLL_MS);
    expect(first).toBe(1);
    expect(second).toBe(1);
  });

  // Guards: polls continuing after a watch is stopped or the poller is disposed, leaking timers and listeners.
  it("stops polling on unwatch and dispose", async () => {
    const { scheduler, power, activity, polling } = harness();
    let runs = 0;
    const stop = polling.watch("acc-1", async () => {
      runs++;
    });
    stop();
    stop();
    await scheduler.advance(2 * FOCUSED_POLL_MS);
    expect(runs).toBe(0);
    polling.watch("acc-1", async () => {
      runs++;
    });
    polling.dispose();
    polling.dispose();
    power.sleep();
    power.wake();
    activity.set("visible");
    await scheduler.advance(5 * FOCUSED_POLL_MS);
    expect(runs).toBe(0);
  });
});

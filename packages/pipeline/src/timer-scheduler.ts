import { createCancelSource } from "@pochimail/kernel/common";
import type { Timer } from "./event-batching.ts";
import type { Scheduler } from "./scheduler.ts";

/** The production `Scheduler`: runs on a platform `Timer`; a cancelled schedule aborts the task it is running, and a task that throws is dropped (its owner reports). */
export function createTimerScheduler(timer: Timer): Scheduler {
  const schedule = (delayMs: number, repeat: boolean, task: Parameters<Scheduler["after"]>[1]) => {
    const source = createCancelSource();
    let cancelTimer: () => void = () => {};
    let stopped = false;
    const arm = () => {
      cancelTimer = timer.set(() => {
        void task(source.signal)
          .catch(() => undefined)
          .finally(() => {
            if (repeat && !stopped) arm();
          });
      }, delayMs);
    };
    arm();
    return () => {
      stopped = true;
      cancelTimer();
      source.abort();
    };
  };
  return {
    every: (intervalMs, task) => schedule(intervalMs, true, task),
    after: (delayMs, task) => schedule(delayMs, false, task),
  };
}

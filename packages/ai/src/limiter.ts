import type { CancelSignal } from "@pochimail/kernel/common";
import { Cancelled } from "@pochimail/kernel/errors";
import { err, ok, type Result } from "@pochimail/kernel/result";

export interface Limiter {
  /** Runs `task` once a slot is free; at most `limit` tasks run at once. A cancel while waiting never starts it. */
  run<T>(signal: CancelSignal, task: () => Promise<T>): Promise<Result<T, Cancelled>>;
  /** Tasks running or waiting. */
  readonly pending: number;
}

export const createLimiter = (limit: number): Limiter => {
  let running = 0;
  const waiting: Array<() => void> = [];
  const waitForSlot = (signal: CancelSignal): Promise<boolean> =>
    new Promise((resolve) => {
      const onAbort = (): void => {
        const at = waiting.indexOf(start);
        if (at >= 0) waiting.splice(at, 1);
        resolve(false);
      };
      const start = (): void => {
        signal.removeEventListener("abort", onAbort);
        resolve(true);
      };
      waiting.push(start);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  return {
    get pending() {
      return running + waiting.length;
    },
    async run(signal, task) {
      if (signal.aborted) return err(new Cancelled());
      // A finished task hands its slot straight to the next waiter, so `running` never dips below the limit while someone waits.
      if (running < limit) running++;
      else if (!(await waitForSlot(signal))) return err(new Cancelled());
      try {
        return ok(await task());
      } finally {
        const next = waiting.shift();
        if (next) next();
        else running--;
      }
    },
  };
};

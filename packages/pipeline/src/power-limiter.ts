import type { CancelSignal } from "@pochimail/kernel/common";
import type { PowerMonitor } from "./power-monitor.ts";

export interface PowerLimits {
  readonly plugged: number;
  readonly battery: number;
}

export interface PowerLimiter {
  /** Waits for a free slot; `undefined` when the signal aborted first. Call the returned function once when done. */
  acquire(signal: CancelSignal): Promise<(() => void) | undefined>;
}

/**
 * Bounded concurrency that follows the power source: `plugged` slots on mains, `battery` slots on battery.
 * The limit is read each time a slot is granted, so unplugging lowers it for new work at once and
 * work already running is never interrupted; plugging in grants the waiting work the new slots at once.
 */
export function createPowerLimiter(power: PowerMonitor, limits: PowerLimits): PowerLimiter {
  let active = 0;
  const waiters: (() => void)[] = [];
  const limit = () => Math.max(1, power.current().onBattery ? limits.battery : limits.plugged);
  const grant = () => {
    while (active < limit()) {
      const next = waiters.shift();
      if (!next) return;
      active += 1;
      next();
    }
  };
  power.onChange(grant);
  return {
    acquire(signal) {
      if (signal.aborted) return Promise.resolve(undefined);
      return new Promise((resolve) => {
        const slot = () => {
          signal.removeEventListener("abort", onAbort);
          let released = false;
          resolve(() => {
            if (released) return;
            released = true;
            active -= 1;
            grant();
          });
        };
        const onAbort = () => {
          const at = waiters.indexOf(slot);
          if (at >= 0) waiters.splice(at, 1);
          resolve(undefined);
        };
        waiters.push(slot);
        signal.addEventListener("abort", onAbort, { once: true });
        grant();
      });
    },
  };
}

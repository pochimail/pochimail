import { type CancelSignal, createCancelSource, type Unsubscribe } from "@pochimail/kernel/common";
import type { PowerMonitor, PowerState } from "./power-monitor.ts";
import type { Scheduler } from "./scheduler.ts";
import type { WindowActivity, WindowActivityState } from "./window-activity.ts";

/** Automatic polling interval per window state. `hiddenMs: null` means no automatic polls while hidden. */
export interface PollCadence {
  readonly focusedMs: number;
  readonly visibleMs: number;
  readonly hiddenMs: number | null;
}

export interface AdaptivePollingDeps {
  readonly scheduler: Scheduler;
  readonly power: PowerMonitor;
  readonly activity: WindowActivity;
  readonly cadence: PollCadence;
  /** Reports a poll that threw; expected failures are Result values and are not reported here. */
  readonly onError?: (error: unknown) => void;
}

export interface AdaptivePolling {
  /** Polls `key` on the adaptive cadence until stopped. One run at a time per key; re-watching replaces the task. */
  watch(key: string, task: (signal: CancelSignal) => Promise<void>): Unsubscribe;
  /** Polls `key` now, whatever the cadence; never doubles a running poll and never runs while paused. */
  trigger(key: string): void;
  /** Stops every watch and releases the power and activity subscriptions. Safe to call twice. */
  dispose(): void;
}

interface Watch {
  readonly task: (signal: CancelSignal) => Promise<void>;
  running: boolean;
  stopped: boolean;
  stopTimer: Unsubscribe | null;
  abort: (() => void) | null;
}

/** ADR 0004: polling pauses on sleep, offline and battery saver. */
const isPaused = (state: PowerState): boolean =>
  state.asleep || !state.online || state.batterySaver;

/** An abort (pause, unwatch, dispose) is not a failure, and a throwing reporter must not escape. */
function report(onError: AdaptivePollingDeps["onError"], error: unknown): void {
  try {
    onError?.(error);
  } catch {
    // The reporter failed; the cadence goes on.
  }
}

/**
 * Adaptive polling (ADR 0004): one poll per key at a time, the cadence following window activity,
 * paused while asleep, offline or in battery saver and resumed once on return. Intervals are
 * injected so this stays free of domain knowledge; a failed poll is retried at the next tick.
 */
export function createAdaptivePolling(deps: AdaptivePollingDeps): AdaptivePolling {
  const { scheduler, power, activity, cadence, onError } = deps;
  const watches = new Map<string, Watch>();
  let powerState = power.current();
  let activityState: WindowActivityState = activity.current();
  let disposed = false;

  const intervalMs = (): number | null => {
    if (activityState === "focused") return cadence.focusedMs;
    if (activityState === "visible") return cadence.visibleMs;
    return cadence.hiddenMs;
  };

  const run = async (watch: Watch): Promise<void> => {
    if (watch.stopped || watch.running || isPaused(powerState)) return;
    watch.running = true;
    const source = createCancelSource();
    watch.abort = source.abort;
    try {
      await watch.task(source.signal);
    } catch (error) {
      // Tasks report expected failures as Result; a throw must not kill the cadence.
      if (!source.signal.aborted) report(onError, error);
    } finally {
      watch.running = false;
      watch.abort = null;
      // Whatever started this run (tick or trigger), the next tick is armed from its end.
      if (!watch.stopped && !disposed) schedule(watch);
    }
  };

  /** Arms the next tick, cancelling any pending one so a key never holds two timers. */
  const schedule = (watch: Watch): void => {
    watch.stopTimer?.();
    watch.stopTimer = null;
    const ms = intervalMs();
    if (watch.stopped || disposed || isPaused(powerState) || ms === null) return;
    watch.stopTimer = scheduler.after(ms, async () => {
      watch.stopTimer = null;
      await run(watch);
    });
  };

  /** Cancels the pending tick and aborts an in-flight run, keeping the watch registered. */
  const cancel = (watch: Watch): void => {
    watch.stopTimer?.();
    watch.stopTimer = null;
    watch.abort?.();
  };

  const offPower = power.onChange((state) => {
    const wasPaused = isPaused(powerState);
    powerState = state;
    if (isPaused(state) === wasPaused) return;
    for (const watch of watches.values()) {
      if (isPaused(state)) cancel(watch);
      else schedule(watch);
    }
  });

  const offActivity = activity.onChange((state) => {
    activityState = state;
    // A running poll finishes undisturbed and re-arms itself at the new cadence; drop its stale tick.
    for (const watch of watches.values()) {
      if (!watch.running) {
        schedule(watch);
        continue;
      }
      watch.stopTimer?.();
      watch.stopTimer = null;
    }
  });

  return {
    watch(key, task) {
      if (disposed) return () => {};
      const previous = watches.get(key);
      if (previous) {
        cancel(previous);
        previous.stopped = true;
        watches.delete(key);
      }
      const watch: Watch = { task, running: false, stopped: false, stopTimer: null, abort: null };
      watches.set(key, watch);
      schedule(watch);
      return () => {
        if (watches.get(key) !== watch) return;
        cancel(watch);
        watch.stopped = true;
        watches.delete(key);
      };
    },
    trigger(key) {
      const watch = watches.get(key);
      if (watch) void run(watch);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      offPower();
      offActivity();
      for (const watch of watches.values()) {
        cancel(watch);
        watch.stopped = true;
      }
      watches.clear();
    },
  };
}

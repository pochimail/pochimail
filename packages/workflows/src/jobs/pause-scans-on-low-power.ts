import type { Unsubscribe } from "@pochimail/kernel/common";
import type { PowerMonitor, PowerState } from "@pochimail/pipeline/power-monitor";
import type { ScanRunner } from "../use-cases/scan-runner.ts";

/** Asleep, or the OS low-power mode (battery saver, ADR 0004). */
const isLowPower = (state: PowerState): boolean => state.asleep || state.batterySaver;

/**
 * Pauses the running scans while the machine sleeps or is low on power and resumes them by themselves
 * afterwards. A scan the user paused stays paused. Pausing and resuming are the runner's own, so
 * nothing is read twice and nothing is skipped.
 */
export function pauseScansOnLowPower(runner: ScanRunner, power: PowerMonitor): Unsubscribe {
  const ours = new Set<string>();
  return power.onChange((state) => {
    if (isLowPower(state)) {
      for (const job of runner.live()) {
        if (job.status !== "running") continue;
        runner.pause(job.jobId);
        ours.add(job.jobId);
      }
      return;
    }
    for (const jobId of ours) runner.resume(jobId);
    ours.clear();
  });
}

import type { Unsubscribe } from "@pochimail/kernel/common";
import type { PowerMonitor, PowerState } from "@pochimail/pipeline/power-monitor";
import type { ScanRunner } from "../use-cases/scan-runner.ts";

/** Asleep, or the OS low-power mode (battery saver, ADR 0004). */
const isLowPower = (state: PowerState): boolean => state.asleep || state.batterySaver;

/**
 * Pauses the running scans when the machine goes into sleep or low-power mode and resumes the ones it
 * paused when it leaves. It acts only on those two transitions, never on other power changes: a scan the
 * user starts or resumes while the machine is already low on power keeps running. A scan the user paused
 * stays paused, even if the user paused it after this job did. Pausing and resuming are the runner's own,
 * so nothing is read twice and nothing is skipped.
 */
export function pauseScansOnLowPower(runner: ScanRunner, power: PowerMonitor): Unsubscribe {
  let wasLow = isLowPower(power.current());
  return power.onChange((state) => {
    const low = isLowPower(state);
    if (low === wasLow) return;
    wasLow = low;
    for (const job of runner.live()) {
      if (low && job.status === "running") runner.pause(job.jobId, "power");
      else if (!low && job.status === "paused" && job.pausedBy === "power")
        runner.resume(job.jobId);
    }
  });
}

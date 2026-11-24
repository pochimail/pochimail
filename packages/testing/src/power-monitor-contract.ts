import { type Check, check, registerContract } from "@pochimail/kernel/testing/contract";
import type { PowerMonitor, PowerState } from "@pochimail/pipeline/power-monitor";
import { expect } from "vitest";

export interface PowerMonitorHarness {
  readonly monitor: PowerMonitor;
  /** Makes the host report this change (a real adapter's test would drive the OS or a stub). */
  change(change: Partial<PowerState>): void;
}

export const powerMonitorChecks: readonly Check<PowerMonitorHarness>[] = [
  check(
    "current reflects a change (guards background work running while offline or asleep)",
    async ({ monitor, change }) => {
      expect(monitor.current().batterySaver).toBe(false);
      change({ online: false, onBattery: true, thermal: "serious", batterySaver: true });
      expect(monitor.current()).toMatchObject({
        online: false,
        onBattery: true,
        thermal: "serious",
        batterySaver: true,
      });
    },
  ),
  check(
    "listeners receive a battery-saver-only change (guards pausing work too late)",
    async ({ monitor, change }) => {
      const seen: PowerState[] = [];
      monitor.onChange((s) => void seen.push(s));
      change({ batterySaver: true });
      expect(seen).toHaveLength(1);
      expect(seen[0]?.batterySaver).toBe(true);
      expect(seen[0]?.asleep).toBe(false);
    },
  ),
  check(
    "a returned state is a snapshot (guards callers mutating the monitor's own state)",
    async ({ monitor }) => {
      const snapshot = monitor.current() as { online: boolean };
      snapshot.online = !snapshot.online;
      expect(monitor.current().online).not.toBe(snapshot.online);
    },
  ),
  check(
    "unsubscribe stops notifications and is harmless twice (guards leaked listeners)",
    async ({ monitor, change }) => {
      let calls = 0;
      const stop = monitor.onChange(() => void calls++);
      stop();
      stop();
      change({ onBattery: true });
      expect(calls).toBe(0);
    },
  ),
];

/** Contract for any `PowerMonitor`. `make` returns a fresh monitor in a normal (plugged-in, online, awake, battery saver off) state. */
export function powerMonitorContract(
  make: () => PowerMonitorHarness | Promise<PowerMonitorHarness>,
): void {
  registerContract("PowerMonitor contract", powerMonitorChecks, make);
}

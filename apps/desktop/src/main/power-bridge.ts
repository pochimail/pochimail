import type { PowerMonitor } from "electron";
import type { PowerMessage } from "../shared/power-message.ts";

const EVENTS = ["on-ac", "on-battery", "suspend", "resume", "thermal-state-change"] as const;

/** The slice of Electron's `powerMonitor` the bridge reads. */
export interface PowerSource {
  isOnBatteryPower(): boolean;
  getCurrentThermalState(): ReturnType<PowerMonitor["getCurrentThermalState"]>;
  on(event: (typeof EVENTS)[number], listener: () => void): unknown;
  off(event: (typeof EVENTS)[number], listener: () => void): unknown;
}

/**
 * Sends the machine's power state to one worker: once now, then after each change. Electron gives no battery
 * saver or reachability signal, so those are always `false` and `true`; thermal state exists on macOS only
 * (elsewhere, or when unknown, it is `nominal`). Call it again for a restarted worker so it starts from the
 * current state. Returns a function that stops listening.
 */
export const bridgePowerToWorker = (
  source: PowerSource,
  worker: { postMessage: (message: PowerMessage) => void },
): (() => void) => {
  let asleep = false;
  let last = "";
  const send = (): void => {
    const thermal = source.getCurrentThermalState();
    const message: PowerMessage = {
      type: "power",
      state: {
        onBattery: source.isOnBatteryPower(),
        thermal: thermal === "unknown" ? "nominal" : thermal,
        online: true,
        asleep,
        batterySaver: false,
      },
    };
    const key = JSON.stringify(message);
    if (key === last) return;
    last = key;
    worker.postMessage(message);
  };
  const onSuspend = (): void => {
    asleep = true;
    send();
  };
  const onResume = (): void => {
    asleep = false;
    send();
  };
  const listeners = {
    "on-ac": send,
    "on-battery": send,
    "thermal-state-change": send,
    suspend: onSuspend,
    resume: onResume,
  } as const;
  for (const event of EVENTS) source.on(event, listeners[event]);
  send();
  return () => {
    for (const event of EVENTS) source.off(event, listeners[event]);
  };
};

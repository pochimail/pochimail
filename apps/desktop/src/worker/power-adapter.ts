import type { PowerMonitor, PowerState } from "@pochimail/pipeline/power-monitor";
import { powerMessageSchema } from "../shared/power-message.ts";

const START: PowerState = {
  onBattery: false,
  thermal: "nominal",
  online: true,
  asleep: false,
  batterySaver: false,
};

/** A `PowerMonitor` fed by main's power messages. Until the first one arrives the machine counts as plugged in and awake. */
export const createMainPowerMonitor = (): {
  readonly monitor: PowerMonitor;
  /** Takes any message from main; one that is not a valid power message is dropped. */
  readonly receive: (message: unknown) => void;
} => {
  let state: PowerState = START;
  const listeners = new Set<(state: PowerState) => void>();
  return {
    monitor: {
      current: () => ({ ...state }),
      onChange(listener) {
        const entry = (next: PowerState) => listener(next);
        listeners.add(entry);
        return () => {
          listeners.delete(entry);
        };
      },
    },
    receive(message) {
      const parsed = powerMessageSchema.safeParse(message);
      if (!parsed.success || JSON.stringify(parsed.data.state) === JSON.stringify(state)) return;
      state = parsed.data.state;
      for (const listener of [...listeners]) listener({ ...state });
    },
  };
};

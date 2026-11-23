import type { PowerMonitor, PowerState } from "@pochimail/pipeline/power-monitor";

export interface FakePowerMonitor extends PowerMonitor {
  /** Changes part of the state and tells listeners if anything changed. */
  set(change: Partial<PowerState>): void;
  goOffline(): void;
  goOnline(): void;
  sleep(): void;
  wake(): void;
}

const NORMAL: PowerState = {
  onBattery: false,
  thermal: "nominal",
  online: true,
  asleep: false,
  batterySaver: false,
};

export function createFakePowerMonitor(initial: Partial<PowerState> = {}): FakePowerMonitor {
  let state: PowerState = { ...NORMAL, ...initial };
  const listeners = new Set<(state: PowerState) => void>();
  const set = (change: Partial<PowerState>) => {
    const next = { ...state, ...change };
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    state = next;
    for (const listener of [...listeners]) listener({ ...state });
  };
  return {
    current: () => ({ ...state }),
    onChange(listener) {
      const entry = (s: PowerState) => listener(s);
      listeners.add(entry);
      return () => {
        listeners.delete(entry);
      };
    },
    set,
    goOffline: () => set({ online: false }),
    goOnline: () => set({ online: true }),
    sleep: () => set({ asleep: true }),
    wake: () => set({ asleep: false }),
  };
}

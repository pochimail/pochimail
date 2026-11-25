import type { PowerMonitor } from "@pochimail/pipeline/power-monitor";
import type { WindowActivity } from "@pochimail/pipeline/window-activity";

/** Stand-in until main reports power state (#318): plugged in, online and awake. */
export const ALWAYS_PLUGGED: PowerMonitor = {
  current: () => ({
    onBattery: false,
    thermal: "nominal",
    online: true,
    asleep: false,
    batterySaver: false,
  }),
  onChange: () => () => {},
};

/** The window on screen but idle: for the demo data and tests; the app is fed by main (window-activity-adapter.ts). */
export const ALWAYS_VISIBLE: WindowActivity = {
  current: () => "visible",
  onChange: () => () => {},
};

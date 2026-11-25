import type { PowerMonitor } from "@pochimail/pipeline/power-monitor";
import type { WindowActivity } from "@pochimail/pipeline/window-activity";

/** Stand-ins until main reports the real state: plugged in, online and awake; window on screen but idle. */
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

export const ALWAYS_VISIBLE: WindowActivity = {
  current: () => "visible",
  onChange: () => () => {},
};

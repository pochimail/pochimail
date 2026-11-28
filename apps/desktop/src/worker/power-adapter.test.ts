import { powerMonitorContract } from "@pochimail/testing/power-monitor-contract";
import { describe, expect, it, vi } from "vitest";
import { createMainPowerMonitor } from "./power-adapter.ts";

powerMonitorContract(() => {
  const { monitor, receive } = createMainPowerMonitor();
  return {
    monitor,
    change: (change) => receive({ type: "power", state: { ...monitor.current(), ...change } }),
  };
});

describe("createMainPowerMonitor", () => {
  it("drops a malformed or unknown message and keeps working (guards a bad message crashing or corrupting the worker)", () => {
    const { monitor, receive } = createMainPowerMonitor();
    const listener = vi.fn();
    monitor.onChange(listener);

    receive(undefined);
    receive("power");
    receive({ type: "other" });
    receive({ type: "power", state: { onBattery: "yes" } });
    receive({ type: "power", state: { ...monitor.current(), thermal: "melting" } });
    expect(listener).not.toHaveBeenCalled();
    expect(monitor.current().onBattery).toBe(false);

    receive({ type: "power", state: { ...monitor.current(), onBattery: true } });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(monitor.current().onBattery).toBe(true);
  });
});

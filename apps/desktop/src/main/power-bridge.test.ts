import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { PowerMessage } from "../shared/power-message.ts";
import { bridgePowerToWorker, type PowerSource } from "./power-bridge.ts";

/** A stub of Electron's `powerMonitor`: an emitter with the two readings the bridge asks for. */
const stubMonitor = () => {
  const emitter = new EventEmitter();
  const reading = {
    onBattery: false,
    thermal: "nominal" as ReturnType<PowerSource["getCurrentThermalState"]>,
  };
  const source: PowerSource = {
    isOnBatteryPower: () => reading.onBattery,
    getCurrentThermalState: () => reading.thermal,
    on: (event, listener) => emitter.on(event, listener),
    off: (event, listener) => emitter.off(event, listener),
  };
  return { source, emitter, reading };
};

const connect = () => {
  const monitor = stubMonitor();
  const sent: PowerMessage[] = [];
  const stop = bridgePowerToWorker(monitor.source, { postMessage: (m) => void sent.push(m) });
  return { ...monitor, sent, stop };
};

describe("bridgePowerToWorker", () => {
  it("sends the current state when the worker connects (guards a worker that starts on battery believing it is plugged in)", () => {
    const monitor = stubMonitor();
    monitor.reading.onBattery = true;
    const sent: PowerMessage[] = [];

    bridgePowerToWorker(monitor.source, { postMessage: (m) => void sent.push(m) });

    expect(sent).toEqual([
      {
        type: "power",
        state: {
          onBattery: true,
          thermal: "nominal",
          online: true,
          asleep: false,
          batterySaver: false,
        },
      },
    ]);
  });

  it("sends plug, unplug, suspend and resume as they happen (guards a scan that never learns the power changed)", () => {
    const { emitter, reading, sent } = connect();

    reading.onBattery = true;
    emitter.emit("on-battery");
    emitter.emit("suspend");
    emitter.emit("resume");
    reading.onBattery = false;
    emitter.emit("on-ac");

    expect(sent.slice(1).map((m) => [m.state.onBattery, m.state.asleep])).toEqual([
      [true, false],
      [true, true],
      [true, false],
      [false, false],
    ]);
  });

  it("reports the macOS thermal state and treats unknown as nominal (guards an unknown reading throttling scans)", () => {
    const { emitter, reading, sent } = connect();

    reading.thermal = "serious";
    emitter.emit("thermal-state-change");
    reading.thermal = "unknown";
    emitter.emit("thermal-state-change");

    expect(sent.slice(1).map((m) => m.state.thermal)).toEqual(["serious", "nominal"]);
  });

  it("does not repeat a state that did not change (guards flooding the worker with duplicate events)", () => {
    const { emitter, sent } = connect();

    emitter.emit("on-ac");
    emitter.emit("thermal-state-change");

    expect(sent).toHaveLength(1);
  });

  it("stops listening once stopped (guards sending to a worker that has gone)", () => {
    const { emitter, sent, stop } = connect();

    stop();
    emitter.emit("suspend");

    expect(sent).toHaveLength(1);
    expect(emitter.listenerCount("suspend")).toBe(0);
  });
});

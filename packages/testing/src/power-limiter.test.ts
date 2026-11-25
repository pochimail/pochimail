import { createCancelSource } from "@pochimail/kernel/common";
import { createPowerLimiter } from "@pochimail/pipeline/power-limiter";
import { describe, expect, it } from "vitest";
import { createFakePowerMonitor } from "./fake-power-monitor.ts";

const open = createCancelSource().signal;

describe("createPowerLimiter", () => {
  // Guards: background work taking every core while the laptop is unplugged.
  it("grants the plugged limit on mains and the battery limit after unplugging", async () => {
    const power = createFakePowerMonitor();
    const limiter = createPowerLimiter(power, { plugged: 3, battery: 1 });
    const granted = await Promise.all([1, 2, 3].map(() => limiter.acquire(open)));
    let fourth = false;
    void limiter.acquire(open).then(() => {
      fourth = true;
    });
    await Promise.resolve();
    expect(granted.every((release) => release !== undefined)).toBe(true);
    expect(fourth).toBe(false);

    power.set({ onBattery: true });
    granted[0]?.();
    granted[1]?.();
    await Promise.resolve();
    expect(fourth).toBe(false);
    granted[2]?.();
    await Promise.resolve();
    expect(fourth).toBe(true);
  });

  // Guards: a cancelled scan leaving a ghost waiter that later takes a slot for nothing.
  it("a waiter that is cancelled gets no slot", async () => {
    const limiter = createPowerLimiter(createFakePowerMonitor({ onBattery: true }), {
      plugged: 2,
      battery: 1,
    });
    const first = await limiter.acquire(open);
    const cancel = createCancelSource();
    const waiting = limiter.acquire(cancel.signal);
    cancel.abort();
    expect(await waiting).toBeUndefined();
    first?.();
    const next = await limiter.acquire(open);
    expect(next).toBeDefined();
  });

  // Guards: work queued on battery staying throttled after the laptop is plugged back in.
  it("plugging in grants the waiting work the new slots without waiting for a release", async () => {
    const power = createFakePowerMonitor({ onBattery: true });
    const limiter = createPowerLimiter(power, { plugged: 3, battery: 1 });
    await limiter.acquire(open);
    let granted = 0;
    for (let n = 0; n < 2; n++)
      void limiter.acquire(open).then(() => {
        granted += 1;
      });
    await Promise.resolve();
    expect(granted).toBe(0);

    power.set({ onBattery: false });
    await Promise.resolve();
    expect(granted).toBe(2);
  });
});

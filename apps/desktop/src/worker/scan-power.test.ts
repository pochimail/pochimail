import { EventEmitter } from "node:events";
import { createCachingClassifier } from "@pochimail/ai/cache";
import type { Classifier } from "@pochimail/classification/ports/classifier";
import { createGroundTruthClassifier } from "@pochimail/classification/testing/ground-truth-classifier";
import { createLogger } from "@pochimail/logger/logger";
import type { PowerMonitor } from "@pochimail/pipeline/power-monitor";
import { createFakePowerMonitor } from "@pochimail/testing/fake-power-monitor";
import { createFakeTimer } from "@pochimail/testing/fake-timer";
import { generateMailbox } from "@pochimail/testing/fixture-mailbox/generator";
import { describe, expect, it, vi } from "vitest";
import { bridgePowerToWorker, type PowerSource } from "../main/power-bridge.ts";
import { DEMO_SEED } from "../shared/demo.ts";
import { createRpcClient } from "../shared/ipc/client.ts";
import { serveRpc } from "../shared/ipc/server.ts";
import { fromDomPort } from "../shared/ipc/transport.ts";
import { createWorkerApp } from "./app.ts";
import { createFixtureAdapters } from "./fixture-adapters.ts";
import { createMainPowerMonitor } from "./power-adapter.ts";

const silent = createLogger({ sink: { write: () => {} } });
const mailbox = generateMailbox({ seed: DEMO_SEED, scale: "small" });
const labels = new Map(mailbox.labels.messages.map((l) => [l.messageId, l.category] as const));
const ACCOUNT = mailbox.accounts[0]?.id ?? "";
const ACCOUNT_SIZE = mailbox.labels.messages.filter((l) => l.accountId === ACCOUNT).length;
const PAGE = 20;

/** The ground-truth engine that counts the messages it infers and holds each call until the test lets it go. */
const engine = () => {
  const inner = createGroundTruthClassifier(labels);
  const state = {
    inferred: 0,
    inFlight: 0,
    peak: 0,
    /** In-flight calls (itself included) at the moment each call started. */
    startedWith: [] as number[],
    hold: false,
    release: [] as (() => void)[],
  };
  const classifier: Classifier = {
    async classify(messages, signal) {
      state.inFlight += 1;
      state.peak = Math.max(state.peak, state.inFlight);
      state.startedWith.push(state.inFlight);
      state.inferred += messages.length;
      if (state.hold) await new Promise<void>((resolve) => state.release.push(resolve));
      else await new Promise((resolve) => setTimeout(resolve, 2));
      state.inFlight -= 1;
      return inner.classify(messages, signal);
    },
  };
  const letGo = () => {
    for (const resolve of state.release.splice(0)) resolve();
  };
  return { classifier, state, letGo };
};

const start = async (classifier: Classifier, power?: PowerMonitor) => {
  let jobs = 0;
  const adapters = await createFixtureAdapters({
    scale: "small",
    timer: createFakeTimer(),
    logger: silent,
    deviceName: () => "Mac",
    classifier,
    newJobId: () => `job-${++jobs}`,
    pageSize: PAGE,
  });
  const app = createWorkerApp(power ? { ...adapters, power } : adapters);
  const { port1, port2 } = new MessageChannel();
  port1.start();
  port2.start();
  serveRpc(fromDomPort(port2), app.handlers);
  const rpc = createRpcClient(fromDomPort(port1));
  const events: string[] = [];
  rpc.subscribe("app.events", undefined, (event) => events.push(event.type));
  const scan = () => rpc.call("scan.start", { accountId: ACCOUNT });
  const state = async () => ({
    overview: await rpc.call("overview.get", {}),
    types: await rpc.call("mailbox.types", { accountIds: [ACCOUNT] }),
  });
  return {
    app,
    rpc,
    events,
    scan,
    state,
    close: () => {
      port1.close();
      port2.close();
    },
  };
};

const uninterrupted = async () => {
  const fake = engine();
  const run = await start(fake.classifier);
  await run.scan();
  await vi.waitFor(() => expect(run.events).toContain("ScanCompleted"));
  await run.app.idle();
  const final = await run.state();
  run.close();
  return final;
};

describe("scan classification speed and power", () => {
  it("scanning the same mailbox twice runs inference once per distinct content (guards a re-scan paying for every message again)", async () => {
    const fake = engine();
    const cached = createCachingClassifier(fake.classifier);
    const first = await start(cached);
    await first.scan();
    await vi.waitFor(() => expect(first.events).toContain("ScanCompleted"));
    await first.app.idle();
    const afterFirst = fake.state.inferred;

    const second = await start(cached);
    await second.scan();
    await vi.waitFor(() => expect(second.events).toContain("ScanCompleted"));
    await second.app.idle();

    expect(afterFirst).toBeLessThan(ACCOUNT_SIZE);
    expect(fake.state.inferred).toBe(afterFirst);
    expect(await second.state()).toEqual(await first.state());
    first.close();
    second.close();
  });

  it("classifies several batches at once on mains and one at a time after unplugging mid-scan (guards a scan flattening the battery)", async () => {
    const fake = engine();
    fake.state.hold = true;
    const power = createFakePowerMonitor();
    const run = await start(fake.classifier, power);
    await run.scan();
    await vi.waitFor(() => expect(fake.state.inFlight).toBeGreaterThan(1));

    power.set({ onBattery: true });
    fake.state.hold = false;
    const before = fake.state.startedWith.length;
    fake.letGo();
    await vi.waitFor(() => expect(run.events).toContain("ScanCompleted"));
    await run.app.idle();

    expect(fake.state.peak).toBeGreaterThan(1);
    expect(fake.state.startedWith.slice(before).every((n) => n === 1)).toBe(true);
    run.close();
  });

  it("sleeping pauses the scan and waking finishes it in the same final state without repeating work (guards a lost, stuck or doubled scan)", async () => {
    const expected = await uninterrupted();
    const fake = engine();
    fake.state.hold = true;
    const power = createFakePowerMonitor();
    const run = await start(fake.classifier, power);
    await run.scan();
    await vi.waitFor(() => expect(fake.state.inFlight).toBeGreaterThan(0));

    power.sleep();
    fake.state.hold = false;
    fake.letGo();
    await run.app.idle();
    const callsWhileAsleep = fake.state.startedWith.length;
    expect(await run.rpc.call("scan.status", { accountIds: [ACCOUNT] })).toMatchObject([
      { status: "paused" },
    ]);
    expect(run.events).not.toContain("ScanCompleted");

    power.wake();
    await vi.waitFor(() => expect(run.events).toContain("ScanCompleted"));
    await run.app.idle();

    expect(fake.state.startedWith.length).toBeGreaterThan(callsWhileAsleep);
    expect(fake.state.inferred).toBe(ACCOUNT_SIZE);
    expect(run.events.filter((type) => type === "ScanCompleted")).toHaveLength(1);
    expect(await run.state()).toEqual(expected);
    run.close();
  });

  it("battery saver pauses the scan and leaving it resumes by itself, but a scan the user paused stays paused (guards waking a scan the user stopped)", async () => {
    const fake = engine();
    fake.state.hold = true;
    const power = createFakePowerMonitor();
    const run = await start(fake.classifier, power);
    const { jobId } = await run.scan();
    await vi.waitFor(() => expect(fake.state.inFlight).toBeGreaterThan(0));
    await run.rpc.call("scan.pause", { jobId });

    power.set({ batterySaver: true });
    power.set({ batterySaver: false });
    fake.state.hold = false;
    fake.letGo();
    await run.app.idle();

    expect(await run.rpc.call("scan.status", { accountIds: [ACCOUNT] })).toMatchObject([
      { status: "paused" },
    ]);
    expect(run.events).not.toContain("ScanCompleted");
    run.close();
  });

  it("a scan the user paused after the machine went low on power stays paused when it leaves low power (guards power waking a scan the user stopped)", async () => {
    const fake = engine();
    fake.state.hold = true;
    const power = createFakePowerMonitor();
    const run = await start(fake.classifier, power);
    const { jobId } = await run.scan();
    await vi.waitFor(() => expect(fake.state.inFlight).toBeGreaterThan(0));

    power.set({ batterySaver: true });
    await run.rpc.call("scan.pause", { jobId });
    power.set({ batterySaver: false });
    fake.state.hold = false;
    fake.letGo();
    await run.app.idle();

    expect(await run.rpc.call("scan.status", { accountIds: [ACCOUNT] })).toMatchObject([
      { status: "paused" },
    ]);
    expect(run.events).not.toContain("ScanCompleted");
    run.close();
  });

  it("a scan started while the machine is already low on power is not paused by later power changes (guards pausing a scan the user chose to run)", async () => {
    const fake = engine();
    fake.state.hold = true;
    const power = createFakePowerMonitor({ batterySaver: true });
    const run = await start(fake.classifier, power);
    await run.scan();
    await vi.waitFor(() => expect(fake.state.inFlight).toBeGreaterThan(0));

    power.set({ onBattery: true });
    power.sleep();
    fake.state.hold = false;
    fake.letGo();
    await vi.waitFor(() => expect(run.events).toContain("ScanCompleted"));
    await run.app.idle();

    expect(await run.rpc.call("scan.status", { accountIds: [ACCOUNT] })).toEqual([]);
    run.close();
  });

  it("power changes reported by main slow the scan on battery, pause it on suspend and finish it on resume (guards the bridge and the worker disagreeing)", async () => {
    const expected = await uninterrupted();
    const electron = new EventEmitter();
    const reading = { onBattery: false };
    const source: PowerSource = {
      isOnBatteryPower: () => reading.onBattery,
      getCurrentThermalState: () => "nominal",
      on: (event, listener) => electron.on(event, listener),
      off: (event, listener) => electron.off(event, listener),
    };
    const worker = createMainPowerMonitor();
    bridgePowerToWorker(source, { postMessage: (message) => worker.receive(message) });
    const fake = engine();
    fake.state.hold = true;
    const run = await start(fake.classifier, worker.monitor);
    await run.scan();
    await vi.waitFor(() => expect(fake.state.inFlight).toBeGreaterThan(1));

    reading.onBattery = true;
    electron.emit("on-battery");
    electron.emit("suspend");
    fake.state.hold = false;
    const before = fake.state.startedWith.length;
    fake.letGo();
    await run.app.idle();
    expect(await run.rpc.call("scan.status", { accountIds: [ACCOUNT] })).toMatchObject([
      { status: "paused" },
    ]);

    electron.emit("resume");
    await vi.waitFor(() => expect(run.events).toContain("ScanCompleted"));
    await run.app.idle();

    expect(fake.state.startedWith.slice(before).every((n) => n === 1)).toBe(true);
    expect(fake.state.inferred).toBe(ACCOUNT_SIZE);
    expect(await run.state()).toEqual(expected);
    run.close();
  });
});

import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err } from "@pochimail/kernel/result";
import { createLogger, type LogRecord } from "@pochimail/logger/logger";
import { describe, expect, it, vi } from "vitest";
import { basicTextVault, fakeVault } from "../test-support/fake-key-vault.ts";
import { createStorageGate } from "./storage-gate.ts";
import { DatabaseKeyError } from "./storage-key.ts";
import { createWorkerLifecycle } from "./worker-lifecycle.ts";

const fakeProcess = () => {
  const emitter = new EventEmitter();
  const posted: { type?: string; databaseKey?: Uint8Array }[] = [];
  return Object.assign(emitter, {
    posted,
    postMessage: (message: { type?: string }) => void posted.push(structuredClone(message)),
    kill: vi.fn(() => void emitter.emit("exit", 0)),
    starts: () => posted.filter((message) => message.type === "start"),
  });
};

const fakeWindow = () => {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    webContents: Object.assign(new EventEmitter(), {
      postMessage: vi.fn(),
      reload: vi.fn(),
      isDestroyed: vi.fn(() => false),
    }),
  });
};

/** The real storage gate and lifecycle; only the processes, windows, timers and the keychain are fakes. */
const setup = (vault = fakeVault(), platform: NodeJS.Platform = "darwin") => {
  const directory = mkdtempSync(join(tmpdir(), "pochimail-lifecycle-"));
  const records: LogRecord[] = [];
  const logger = createLogger({ sink: { write: (record) => records.push(record) } });
  const gate = createStorageGate({
    vault,
    platform,
    directory,
    databaseFile: join(directory, "pochimail.db"),
    logger,
  });
  const workers: ReturnType<typeof fakeProcess>[] = [];
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const handedKeys: Buffer[] = [];
  const build = (loadKey = gate.key) =>
    createWorkerLifecycle({
      forkWorker: () => {
        const worker = fakeProcess();
        workers.push(worker);
        return worker as never;
      },
      forkModelHost: () => fakeProcess() as never,
      createChannel: () => new MessageChannel() as never,
      timer: {
        set: (fn, ms) => {
          const entry = { fn, ms, cancelled: false };
          timers.push(entry);
          return () => {
            entry.cancelled = true;
          };
        },
      },
      secrets: {} as never,
      databasePath: join(directory, "pochimail.db"),
      loadKey: async () => {
        const loaded = await loadKey();
        if (loaded.ok && loaded.value !== undefined) handedKeys.push(loaded.value);
        return loaded;
      },
      openExternal: async () => undefined,
      logger,
    });
  const fire = (ms: number) => {
    for (const timer of timers.filter((entry) => entry.ms === ms && !entry.cancelled)) timer.fn();
  };
  return { gate, records, workers, handedKeys, timers, build, fire };
};
const workerAt = (workers: ReturnType<typeof fakeProcess>[], index: number) => {
  const worker = workers[index];
  if (worker === undefined) throw new Error(`no worker ${index}`);
  return worker;
};

describe("worker lifecycle", () => {
  // Guards: a worker started before the person answered the storage question, or without the database key.
  it("starts the worker only once the storage gate has its key, then hands it over and zeroes main's copy", async () => {
    const { gate, workers, handedKeys, build } = setup(basicTextVault(), "linux");
    build().connect(fakeWindow() as never);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(workerAt(workers, 0).starts()).toEqual([]);

    expect(await gate.storeUnprotected()).toBe("ready");
    await vi.waitFor(() => expect(workerAt(workers, 0).starts()).toHaveLength(1));
    const [start] = workerAt(workers, 0).starts();
    expect(start?.databaseKey).toHaveLength(32);
    expect(handedKeys.every((key) => key.every((byte) => byte === 0))).toBe(true);
  });

  // Guards: a second window asking the person again, or minting a second key that cannot open the first window's database.
  it("gives a second window's worker the same key", async () => {
    const { workers, handedKeys, build } = setup();
    const lifecycle = build();
    lifecycle.connect(fakeWindow() as never);
    lifecycle.connect(fakeWindow() as never);
    await vi.waitFor(() => {
      expect(workerAt(workers, 0).starts()).toHaveLength(1);
      expect(workerAt(workers, 1).starts()).toHaveLength(1);
    });
    expect(workerAt(workers, 1).starts()[0]?.databaseKey).toEqual(
      workerAt(workers, 0).starts()[0]?.databaseKey,
    );
    expect(handedKeys).toHaveLength(2);
    expect(handedKeys[0]).not.toBe(handedKeys[1]);
  });

  // Guards: a crashed worker leaving the window dead until the app is restarted, or restarting without the database key.
  it("restarts a crashed worker with the same key and reloads the page for a new port", async () => {
    const { workers, build } = setup();
    const window = fakeWindow();
    build().connect(window as never);
    await vi.waitFor(() => expect(workerAt(workers, 0).starts()).toHaveLength(1));

    workerAt(workers, 0).emit("exit", 139);
    await vi.waitFor(() => expect(workerAt(workers, 1).starts()).toHaveLength(1));
    expect(workerAt(workers, 1).starts()[0]?.databaseKey).toEqual(
      workerAt(workers, 0).starts()[0]?.databaseKey,
    );
    expect(window.webContents.reload).toHaveBeenCalledTimes(1);
    expect(window.webContents.listenerCount("did-finish-load")).toBe(1);
  });

  // Guards: a restart reloading a window that was destroyed meanwhile, which throws in main.
  it("does not reload a destroyed window when restarting", async () => {
    const { workers, build } = setup();
    const window = fakeWindow();
    window.webContents.isDestroyed.mockReturnValue(true);
    build().connect(window as never);
    await vi.waitFor(() => expect(workerAt(workers, 0).starts()).toHaveLength(1));

    workerAt(workers, 0).emit("exit", 139);
    await vi.waitFor(() => expect(workerAt(workers, 1).starts()).toHaveLength(1));
    expect(window.webContents.reload).not.toHaveBeenCalled();
  });

  // Guards: the restart budget recovering while the worker is still waiting for the person's storage choice.
  it("starts the stable-run timer when the worker boots, not when it is forked", async () => {
    const { gate, timers, build } = setup(basicTextVault(), "linux");
    build().connect(fakeWindow() as never);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(timers.filter((entry) => entry.ms === 60_000)).toEqual([]);

    expect(await gate.storeUnprotected()).toBe("ready");
    await vi.waitFor(() => expect(timers.filter((entry) => entry.ms === 60_000)).toHaveLength(1));
  });

  // Guards: a worker that crashes at once in a loop, burning the CPU forever.
  it("gives up after repeated crashes and recovers its budget once a worker stayed up", async () => {
    const { workers, records, build, fire } = setup();
    build().connect(fakeWindow() as never);
    for (let crash = 0; crash < 3; crash += 1) {
      await vi.waitFor(() => expect(workerAt(workers, crash).starts()).toHaveLength(1));
      workerAt(workers, crash).emit("exit", 1);
    }
    await vi.waitFor(() => expect(workerAt(workers, 3).starts()).toHaveLength(1));
    fire(60_000);
    workerAt(workers, 3).emit("exit", 1);
    await vi.waitFor(() => expect(workerAt(workers, 4).starts()).toHaveLength(1));

    for (let crash = 4; crash < 7; crash += 1) {
      await vi.waitFor(() => expect(workerAt(workers, crash).starts()).toHaveLength(1));
      workerAt(workers, crash).emit("exit", 1);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(workers).toHaveLength(7);
    expect(records.some((record) => record.message.includes("giving up"))).toBe(true);
  });

  // Guards: restarting forever a worker that main itself stopped because the key could not be loaded.
  it("does not restart a worker that was refused its key", async () => {
    const { workers, build } = setup();
    build(async () => err(new DatabaseKeyError("key-file-invalid"))).connect(fakeWindow() as never);
    await vi.waitFor(() => expect(workerAt(workers, 0).kill).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(workers).toHaveLength(1);
    expect(workerAt(workers, 0).starts()).toEqual([]);
  });

  // Guards: the process being stopped while the database is open, which leaves a WAL that must be recovered.
  it("asks the worker to close the database on window close and stops it only after the answer", async () => {
    const { workers, build } = setup();
    const window = fakeWindow();
    build().connect(window as never);
    await vi.waitFor(() => expect(workerAt(workers, 0).starts()).toHaveLength(1));
    const worker = workerAt(workers, 0);

    window.emit("closed");
    expect(worker.posted.at(-1)).toEqual({ type: "shutdown" });
    expect(worker.kill).not.toHaveBeenCalled();
    worker.emit("message", { type: "database-closed" });
    await vi.waitFor(() => expect(worker.kill).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(workers).toHaveLength(1);
  });

  // Guards: quitting hanging forever on a worker that never answers the shutdown.
  it("stops a worker that does not answer within the grace period, for every open window", async () => {
    const { workers, build, fire } = setup();
    const lifecycle = build();
    lifecycle.connect(fakeWindow() as never);
    lifecycle.connect(fakeWindow() as never);
    await vi.waitFor(() => {
      expect(workerAt(workers, 0).starts()).toHaveLength(1);
      expect(workerAt(workers, 1).starts()).toHaveLength(1);
    });

    let finished = false;
    const done = lifecycle.shutdown().then(() => {
      finished = true;
    });
    expect(workers.map((worker) => worker.posted.at(-1))).toEqual([
      { type: "shutdown" },
      { type: "shutdown" },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(finished).toBe(false);
    fire(3_000);
    await done;
    expect(workers.every((worker) => worker.kill.mock.calls.length === 1)).toBe(true);
  });
});

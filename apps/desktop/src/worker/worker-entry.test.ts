// Guards: a worker that serves the connect dead end instead of opening the database it was handed at startup.
import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStorage } from "@pochimail/db/open-storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRpcClient } from "../shared/ipc/client.ts";
import { fromDomPort } from "../shared/ipc/transport.ts";

type WorkerPort = {
  postMessage: (message: unknown) => void;
  on: (event: "message", listener: (event: { data: unknown }) => void) => void;
  start: () => void;
  close: () => void;
};

const asWorkerPort = (port: MessagePort): WorkerPort => ({
  postMessage: (message) => port.postMessage(message),
  on: (event, listener) =>
    event === "message"
      ? port.addEventListener("message", (messageEvent) => listener({ data: messageEvent.data }))
      : port.addEventListener("close", () => listener({ data: undefined })),
  start: () => port.start(),
  close: () => port.close(),
});

const originalParentPort = process.parentPort;
const originalEnv = {
  POCHIMAIL_DEMO: process.env.POCHIMAIL_DEMO,
  POCHIMAIL_GOOGLE_CLIENT_ID: process.env.POCHIMAIL_GOOGLE_CLIENT_ID,
};
const dirs: string[] = [];

beforeEach(() => {
  vi.resetModules();
  delete process.env.POCHIMAIL_DEMO;
  delete process.env.POCHIMAIL_GOOGLE_CLIENT_ID;
});

afterEach(() => {
  process.parentPort = originalParentPort;
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The real worker module over its real IPC layer, started exactly as main starts it. */
const boot = async (databasePath: string, key: Buffer | undefined) => {
  const parent = new EventEmitter();
  process.parentPort = parent as never;
  await import("./worker.ts");

  const secrets = new MessageChannel();
  secrets.port1.start();
  parent.emit("message", {
    data: {
      type: "start",
      databasePath,
      ...(key === undefined ? {} : { databaseKey: new Uint8Array(key) }),
    },
    ports: [asWorkerPort(secrets.port1)],
  });

  const rpc = new MessageChannel();
  const client = createRpcClient(fromDomPort(rpc.port1));
  rpc.port1.start();
  parent.emit("message", { data: { type: "port" }, ports: [asWorkerPort(rpc.port2)] });
  return {
    client,
    close: () => {
      parent.emit("message", { data: { type: "shutdown" }, ports: [] });
      rpc.port1.close();
      rpc.port2.close();
      secrets.port1.close();
      secrets.port2.close();
    },
  };
};

const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "pochimail-entry-"));
  dirs.push(dir);
  return dir;
};

describe("worker entry", () => {
  // Guards: the connect handler being registered before the store exists, which answered storage-unavailable on a click.
  it("opens the handed database and reaches the real connect handler", async () => {
    const databasePath = join(tempDir(), "pochimail.db");
    const key = randomBytes(32);
    const { client, close } = await boot(databasePath, key);

    expect(await client.call("accounts.connect", { provider: "google" })).toEqual({
      status: "failed",
      reason: "not-configured",
    });

    const storage = openStorage(databasePath, key);
    if (!storage.ok) throw storage.error;
    try {
      expect(
        storage.value.reader.prepare("SELECT count(*) AS n FROM sqlite_master").get(),
      ).toMatchObject({ n: expect.any(Number) });
      expect(Number(storage.value.reader.pragma("user_version", { simple: true }))).toBeGreaterThan(
        0,
      );
    } finally {
      storage.value.close();
    }
    close();
  });

  // Guards: a genuinely unusable database still gets a clear, closed failure.
  it("answers storage-unavailable when the handed path cannot be opened", async () => {
    const databasePath = tempDir(); // a directory, not a database file
    const { client, close } = await boot(databasePath, randomBytes(32));

    expect(await client.call("accounts.connect", { provider: "google" })).toEqual({
      status: "failed",
      reason: "storage-unavailable",
    });
    close();
  });
});

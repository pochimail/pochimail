import { err, ok } from "@pochimail/kernel/result";
import { createLogger, type LogRecord } from "@pochimail/logger/logger";
import { describe, expect, it } from "vitest";
import { DatabaseKeyError } from "./storage-key.ts";
import { bootWorker } from "./worker-start.ts";

const setup = () => {
  const records: LogRecord[] = [];
  const posted: unknown[] = [];
  let killed = false;
  return {
    records,
    posted,
    killed: () => killed,
    options: {
      databasePath: "/dev-data/pochimail.db",
      worker: {
        postMessage: (m: unknown) => void posted.push(structuredClone(m)), // what the worker receives, taken before main zeroes its copy
        kill: () => {
          killed = true;
        },
      },
      secrets: {} as never,
      createChannel: () => new MessageChannel() as never,
      logger: createLogger({ sink: { write: (r) => records.push(r) } }),
    },
  };
};

describe("worker boot", () => {
  // Guards: the worker silently starting without (or with a fresh) database key after the key file failed to load.
  it.each([
    [
      "an invalid key file",
      async () => err(new DatabaseKeyError("key-file-invalid")),
      "key-file-invalid",
    ],
    [
      "a missing key with an existing database",
      async () => err(new DatabaseKeyError("key-missing-database-exists")),
      "key-missing-database-exists",
    ],
    [
      "an unexpected throw",
      async () => {
        throw new Error("EACCES /secret/path");
      },
      "unexpected",
    ],
  ])(
    "does not start the worker and logs a redacted error on %s",
    async (_name, loadKey, reason) => {
      const t = setup();
      expect(await bootWorker({ ...t.options, loadKey })).toBe(false);
      expect(t.killed()).toBe(true);
      expect(t.posted).toEqual([]);
      expect(t.records).toHaveLength(1);
      expect(t.records[0]?.level).toBe("error");
      expect(JSON.stringify(t.records)).toContain(reason.replaceAll("-", " "));
      expect(JSON.stringify(t.records)).not.toContain("/secret/path");
    },
  );

  // Guards: the happy path regressing into a refusal to start.
  it("starts the worker with the key when it loads", async () => {
    const t = setup();
    expect(await bootWorker({ ...t.options, loadKey: async () => ok(Buffer.alloc(32, 1)) })).toBe(
      true,
    );
    expect(t.posted).toEqual([
      {
        type: "start",
        databasePath: "/dev-data/pochimail.db",
        databaseKey: new Uint8Array(32).fill(1),
      },
    ]);
  });

  // Guards: the key staying readable in main's memory after it was handed to the worker.
  it("zeroes the key buffer once the worker has it", async () => {
    const t = setup();
    const key = Buffer.alloc(32, 1);
    await bootWorker({ ...t.options, loadKey: async () => ok(key) });
    expect(key.every((byte) => byte === 0)).toBe(true);
  });
});

import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, type LogRecord } from "@pochimail/logger/logger";
import { describe, expect, it } from "vitest";
import { basicTextVault, fakeVault } from "../test-support/fake-key-vault.ts";
import { openEncrypted } from "../worker/storage-proof.ts";
import { createStorageGate } from "./storage-gate.ts";
import type { KeyVault } from "./storage-key.ts";

const PASSPHRASE = "correct horse battery staple";
const WRONG = "wrong horse battery staple";

const setup = (vault: KeyVault = basicTextVault(), platform: NodeJS.Platform = "linux") => {
  const directory = mkdtempSync(join(tmpdir(), "pochimail-gate-"));
  const records: LogRecord[] = [];
  const open = (dir = directory) =>
    createStorageGate({
      vault,
      platform,
      directory: dir,
      databaseFile: join(dir, "pochimail.db"),
      logger: createLogger({ sink: { write: (record) => records.push(record) } }),
    });
  return { directory, records, open, gate: open() };
};
const filesIn = (directory: string) => readdirSync(directory).sort();
const everythingOnDisk = (directory: string) =>
  filesIn(directory)
    .map((name) => readFileSync(join(directory, name), "utf8"))
    .join("\n");
const keyOf = async (gate: ReturnType<typeof setup>["gate"]) => {
  const loaded = await gate.key();
  if (!loaded.ok || loaded.value === undefined) throw new Error("expected a key");
  return loaded.value;
};
/** True when the promise has not settled after the event loop turned a few times. */
const stillPending = async (promise: Promise<unknown>) => {
  let settled = false;
  void promise.then(() => (settled = true));
  for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setImmediate(resolve));
  return !settled;
};

describe("storage gate: basic-text", () => {
  // Guards: the key landing on disk (even obfuscated) before the person has chosen on a basic-text backend.
  it("asks first, writes no file and starts nothing until the person chooses", async () => {
    const { gate, directory } = setup();
    expect(await gate.status()).toBe("choose");
    expect(filesIn(directory)).toEqual([]);
    expect(await stillPending(gate.key())).toBe(true);
    expect(filesIn(directory)).toEqual([]);
  });

  // Guards: the passphrase, the derived key or any key material being stored; only parameters, salt and a verifier may be.
  it("keeps a passphrase out of every file and records its scrypt parameters", async () => {
    const { gate, directory } = setup();
    const waiting = gate.key();
    expect(await gate.setPassphrase(PASSPHRASE)).toBe("ready");
    const key = await keyOf(gate);
    expect((await waiting).ok).toBe(true);
    const flag = JSON.parse(readFileSync(join(directory, "storage-protection.json"), "utf8"));
    expect(flag).toMatchObject({
      mode: "passphrase",
      kdf: { name: "scrypt", N: 131072, r: 8, p: 1 },
    });
    expect(flag.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(filesIn(directory)).toEqual(["storage-protection.json"]);
    const disk = everythingOnDisk(directory);
    expect(disk).not.toContain(PASSPHRASE);
    expect(disk).not.toContain(key.toString("hex"));
    if (process.platform !== "win32")
      expect(statSync(join(directory, "storage-protection.json")).mode & 0o777).toBe(0o600);
  });

  // Guards: a wrong passphrase unlocking the data, or the right one failing after a restart.
  it("opens the same database after a restart only with the right passphrase", async () => {
    const first = setup();
    await first.gate.setPassphrase(PASSPHRASE);
    const dbFile = join(first.directory, "pochimail.db");
    const db = openEncrypted(dbFile, await keyOf(first.gate));
    db.exec("create table t(x); insert into t values (42)");
    db.close();

    const restarted = first.open();
    expect(await restarted.status()).toBe("locked");
    const waiting = restarted.key();
    expect(await restarted.unlock(WRONG)).toBe("wrong-passphrase");
    expect(await stillPending(waiting)).toBe(true);
    expect(await restarted.unlock(PASSPHRASE)).toBe("ready");
    const reopened = openEncrypted(dbFile, await keyOf(restarted));
    expect(reopened.prepare("select x from t").get()).toEqual({ x: 42 });
    reopened.close();
    expect(() =>
      openEncrypted(dbFile, Buffer.alloc(32, 9)).prepare("select x from t").get(),
    ).toThrow();
  });

  // Guards: "store without protection" persisting more than a flag, or asking again on every launch.
  it("stores without protection only as an explicit choice, persisting a flag and a private key file", async () => {
    const first = setup();
    expect(await first.gate.storeUnprotected()).toBe("ready");
    const key = await keyOf(first.gate);
    expect(
      JSON.parse(readFileSync(join(first.directory, "storage-protection.json"), "utf8")),
    ).toEqual({
      mode: "unprotected",
    });
    if (process.platform !== "win32")
      expect(statSync(join(first.directory, "db.key.plain")).mode & 0o777).toBe(0o600);
    const restarted = first.open();
    expect(await restarted.status()).toBe("ready");
    expect(await keyOf(restarted)).toEqual(key);
  });

  // Guards: a compromised renderer downgrading a passphrase to no protection, or re-answering a settled question.
  it("refuses every answer once the question is closed", async () => {
    const { gate, directory, open } = setup();
    await gate.setPassphrase(PASSPHRASE);
    expect(await gate.storeUnprotected()).toBe("failed");
    expect(await gate.setPassphrase(WRONG)).toBe("failed");
    expect(await gate.unlock(PASSPHRASE)).toBe("failed");
    expect(filesIn(directory)).toEqual(["storage-protection.json"]);
    expect(await open().storeUnprotected()).toBe("failed"); // locked, not choosable
    expect(filesIn(directory)).toEqual(["storage-protection.json"]);
  });

  // Guards: a too short, too long or non-string passphrase being accepted by main because only the renderer checked it.
  it("validates the passphrase in main", async () => {
    const { gate, directory } = setup();
    for (const bad of [
      "short",
      "x".repeat(257),
      12345678,
      undefined,
      { toString: () => PASSPHRASE },
    ])
      expect(await gate.setPassphrase(bad)).toBe("failed");
    expect(filesIn(directory)).toEqual([]);
    const locked = setup();
    await locked.gate.setPassphrase(PASSPHRASE);
    expect(await locked.open().unlock("short")).toBe("wrong-passphrase");
  });

  // Guards: minting a key over an existing database (orphaning its data) when the choice file was lost.
  it("never creates a key when a database already exists", async () => {
    const { gate, directory } = setup();
    writeFileSync(join(directory, "pochimail.db"), "existing encrypted data");
    expect(await gate.storeUnprotected()).toBe("failed");
    expect(await gate.setPassphrase(PASSPHRASE)).toBe("failed");
    expect(filesIn(directory)).toEqual(["pochimail.db"]);
  });

  // Guards: a damaged choice file being read as "no choice yet", which would ask again and mint a new key.
  it("fails loudly when the choice file is damaged", async () => {
    const { directory, open } = setup();
    writeFileSync(join(directory, "storage-protection.json"), '{"mode":"passphrase"}');
    const result = await open().key();
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.reason).toBe("choice-file-invalid");
  });

  // Guards: two windows sharing one buffer, so zeroing it for one worker start breaks the next.
  it("hands out a fresh copy of the key each time and wipes what it holds on dispose", async () => {
    const { gate } = setup();
    await gate.storeUnprotected();
    const first = await keyOf(gate);
    first.fill(0);
    const second = await keyOf(gate);
    expect(second.some((byte) => byte !== 0)).toBe(true);
    gate.dispose();
    expect((await keyOf(gate)).every((byte) => byte === 0)).toBe(true);
  });
});

describe("storage gate: os-keychain", () => {
  // Guards: the prompt (or a choice file) appearing where the OS keychain already protects the key.
  it.each([
    ["darwin", fakeVault()],
    ["win32", fakeVault()],
    ["linux", fakeVault({ getSelectedStorageBackend: () => "gnome_libsecret" })],
  ] as const)(
    "never asks on %s and keeps the key wrapped by the keychain",
    async (platform, vault) => {
      const { gate, directory } = setup(vault, platform);
      expect(await gate.status()).toBe("ready");
      const key = await keyOf(gate);
      expect(filesIn(directory)).toEqual(["db.key"]);
      expect(readFileSync(join(directory, "db.key"), "utf8").startsWith("wrapped:")).toBe(true);
      expect(await gate.setPassphrase(PASSPHRASE)).toBe("failed");
      expect(await gate.storeUnprotected()).toBe("failed");
      expect(filesIn(directory)).toEqual(["db.key"]);
      expect(await keyOf(setup(vault, platform).open(directory))).toEqual(key);
    },
  );

  // Guards: a missing keychain being treated as basic-text and prompting, instead of the existing "no key" behaviour.
  it("does not ask when no keychain exists at all", async () => {
    const { gate, directory } = setup(
      fakeVault({ isAsyncEncryptionAvailable: async () => false }),
      "win32",
    );
    expect(await gate.status()).toBe("ready");
    expect(await gate.key()).toEqual({ ok: true, value: undefined });
    expect(filesIn(directory)).toEqual([]);
  });
});

describe("storage gate: logs", () => {
  // Guards: a passphrase, key, salt or verifier reaching the logs on any path, including the error paths.
  it("never logs secrets on success, wrong passphrase, invalid input or write failure", async () => {
    const secrets: string[] = [PASSPHRASE, WRONG, "tiny-1"];
    const good = setup();
    await good.gate.setPassphrase("tiny-1");
    await good.gate.setPassphrase(PASSPHRASE);
    secrets.push((await keyOf(good.gate)).toString("hex"));
    const flag = JSON.parse(readFileSync(join(good.directory, "storage-protection.json"), "utf8"));
    secrets.push(flag.salt, flag.verifier);
    const locked = good.open();
    await locked.unlock(WRONG);
    await locked.unlock(PASSPHRASE);
    await good.open().unlock(PASSPHRASE); // closed question

    const brokenDirectory = join(good.directory, "missing", "deeper");
    const broken = setup();
    const failing = broken.open(brokenDirectory);
    await failing.setPassphrase(PASSPHRASE);
    const failingPlain = broken.open(brokenDirectory);
    await failingPlain.storeUnprotected();

    const records = [...good.records, ...broken.records];
    expect(records.length).toBeGreaterThan(0);
    expect(records.some((record) => record.level === "error")).toBe(true);
    const logged = JSON.stringify(records);
    for (const secret of secrets) expect(logged).not.toContain(secret);
  });
});

import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { secretStoreContract } from "@pochimail/accounts/testing/secret-store-contract";
import { createLogger, type LogRecord } from "@pochimail/logger/logger";
import { describe, expect, it } from "vitest";
import { createSecretsClient, serveSecrets } from "../shared/ipc/secrets.ts";
import { SecretStoreError } from "../shared/secret-error.ts";
import { createSecretVault } from "./secret-vault.ts";
import type { KeyVault } from "./storage-key.ts";

const SECRET = "tok-s3cret-VALUE-9f1c";

/** Only the Electron `safeStorage` boundary is faked: a reversible wrap whose ciphertext visibly differs from the plaintext. */
const fakeSafeStorage = (overrides: Partial<KeyVault> = {}): KeyVault => ({
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async (plain) => Buffer.from(`wrapped:${Buffer.from(plain).toString("hex")}`),
  decryptStringAsync: async (cipher) => {
    const text = cipher.toString();
    if (!text.startsWith("wrapped:")) throw new Error(`cannot decrypt ${text}`);
    return { result: Buffer.from(text.slice(8), "hex").toString(), shouldReEncrypt: false };
  },
  ...overrides,
});
const file = () => join(mkdtempSync(join(tmpdir(), "pochimail-secrets-")), "secrets.json");
const linux = (backend: string) => fakeSafeStorage({ getSelectedStorageBackend: () => backend });

/** The full production path: client (worker side) <-> MessageChannel <-> serveSecrets <-> vault (main side). */
const workerStore = (vault: ReturnType<typeof createSecretVault>, timeoutMs?: number) => {
  const { port1, port2 } = new MessageChannel();
  const side = (port: MessagePort) => ({
    post: (message: unknown) => port.postMessage(message),
    onMessage: (handler: (data: unknown) => void) =>
      port.addEventListener("message", (event) => handler(event.data)),
  });
  serveSecrets(side(port1), vault);
  const client = createSecretsClient(side(port2), timeoutMs);
  port1.start();
  port2.start();
  return {
    client,
    close: () => {
      port1.close();
      port2.close();
    },
  };
};
const darwinVault = (path = file()) =>
  createSecretVault({ vault: fakeSafeStorage(), file: path, platform: "darwin" });

secretStoreContract(() => workerStore(darwinVault()).client);

describe("secret store behind the main process", () => {
  // Guards: a restart losing the refresh token (forces re-login), or a token written unwrapped.
  it("keeps secrets across a restart and never writes them in plain text", async () => {
    const path = file();
    await darwinVault(path).set("refresh-token", SECRET);
    const restarted = workerStore(darwinVault(path)).client;
    expect(await restarted.get("refresh-token")).toEqual({ ok: true, value: SECRET });
    expect(readFileSync(path, "utf8")).not.toContain(SECRET);
  });

  // Guards: silently storing under Linux's hard-coded basic_text password; nothing may hit the disk.
  it("refuses to set a secret on basic-text without a passphrase and writes nothing", async () => {
    const path = file();
    const vault = createSecretVault({ vault: linux("basic_text"), file: path, platform: "linux" });
    const { client } = workerStore(vault);
    expect(await client.protection()).toEqual({ level: "basic-text" });
    const result = await client.set("refresh-token", SECRET);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatchObject({ reason: "protection-unavailable" });
    expect(() => readFileSync(path)).toThrow();
  });

  // Guards: a damaged entry or file crashing the worker, or being "repaired" by silently overwriting other secrets.
  it("returns a typed corrupted error for a damaged entry or file instead of throwing", async () => {
    const path = file();
    const vault = darwinVault(path);
    await vault.set("good", "1");
    writeFileSync(
      path,
      JSON.stringify({ version: 1, entries: { bad: "bm90LXdyYXBwZWQ=", good: "x" } }),
    );
    const { client } = workerStore(vault);
    const bad = await client.get("bad");
    expect(!bad.ok && bad.error).toBeInstanceOf(SecretStoreError);
    expect(!bad.ok && bad.error).toMatchObject({ reason: "corrupted" });
    writeFileSync(path, "{not json");
    expect(await client.get("good")).toMatchObject({ ok: false, error: { reason: "corrupted" } });
    expect(await client.set("x", "y")).toMatchObject({ ok: false, error: { reason: "corrupted" } });
    expect(readFileSync(path, "utf8")).toBe("{not json");
  });

  // Guards: lost updates when the worker fires several writes at once.
  it("keeps every secret when writes race", async () => {
    const { client } = workerStore(darwinVault());
    await Promise.all(["a", "b", "c", "d"].map((k) => client.set(k, `v-${k}`)));
    for (const k of ["a", "b", "c", "d"])
      expect(await client.get(k)).toEqual({ ok: true, value: `v-${k}` });
  });

  // Guards: the UI/worker hanging forever when main never answers.
  it("fails with an unreachable error when main does not answer", async () => {
    const { port1 } = new MessageChannel();
    const client = createSecretsClient(
      { post: (m) => port1.postMessage(m), onMessage: () => undefined },
      20,
    );
    expect(await client.get("x")).toMatchObject({ ok: false, error: { reason: "unreachable" } });
  });

  // Guards: a secret value leaking into a log record, an error message or its cause when the keychain call fails.
  it("never puts a secret value in logs or errors, even when the keychain throws it back", async () => {
    const records: LogRecord[] = [];
    const logger = createLogger({ sink: { write: (record) => records.push(record) } });
    const vault = createSecretVault({
      vault: fakeSafeStorage({
        encryptStringAsync: async (plain) => {
          throw new Error(`keychain exploded on ${plain}`);
        },
      }),
      file: file(),
      platform: "darwin",
      logger,
    });
    const { client } = workerStore(vault);
    const result = await client.set(SECRET, SECRET);
    expect(result.ok).toBe(false);
    const seen = JSON.stringify([
      records,
      !result.ok && [result.error.message, result.error.cause],
    ]);
    expect(records.length).toBeGreaterThan(0);
    expect(seen).not.toContain(SECRET);
  });
});

describe("secret vault write safety", () => {
  // Guards: a plain read re-wrapping (writing) secrets under the weak basic_text backend.
  it("a read on basic-text writes nothing", async () => {
    const path = file();
    await darwinVault(path).set("refresh-token", SECRET);
    const before = readFileSync(path);
    const reWrapping = linux("basic_text");
    const noPassphrase = createSecretVault({
      vault: {
        ...reWrapping,
        decryptStringAsync: async (cipher) => ({
          ...(await reWrapping.decryptStringAsync(cipher)),
          shouldReEncrypt: true,
        }),
      },
      file: path,
      platform: "linux",
    });
    expect(await noPassphrase.get("refresh-token")).toEqual({ ok: true, value: SECRET });
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  // Guards: secrets.json readable by other users, or left torn/with a stray temp file after a failed write.
  it("keeps the file private and leaves the old content intact when a write fails", async () => {
    const path = file();
    const vault = darwinVault(path);
    await vault.set("a", "1");
    if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
    const before = readFileSync(path);
    const failing = createSecretVault({
      vault: fakeSafeStorage({
        encryptStringAsync: async () => {
          throw new Error("boom");
        },
      }),
      file: path,
      platform: "darwin",
    });
    expect((await failing.set("b", "2")).ok).toBe(false);
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  // Guards: two windows' workers sharing one process vault overwriting each other's update (lost token).
  it("loses no update when two workers write concurrently through the one process vault", async () => {
    const vault = darwinVault();
    const one = workerStore(vault).client;
    const two = workerStore(vault).client;
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => [
        one.set(`one-${i}`, `1-${i}`),
        two.set(`two-${i}`, `2-${i}`),
      ]).flat(),
    );
    for (let i = 0; i < 10; i++) {
      expect(await two.get(`one-${i}`)).toEqual({ ok: true, value: `1-${i}` });
      expect(await one.get(`two-${i}`)).toEqual({ ok: true, value: `2-${i}` });
    }
  });
});

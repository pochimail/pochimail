import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "@pochimail/logger/logger";
import { describe, expect, it, vi } from "vitest";
import { basicTextVault } from "../test-support/fake-key-vault.ts";
import { createSecretVault } from "./secret-vault.ts";
import { createStorageGate } from "./storage-gate.ts";

// Each passphrase check runs the real scrypt (128 MiB); a loaded CI machine needs more than the default 5 seconds.
vi.setConfig({ testTimeout: 60_000 });

const SECRET = "tok-s3cret-VALUE-9f1c";
const PASSPHRASE = "correct horse battery staple";

/** One Linux `basic_text` install: the gate and the secrets vault main builds, restartable over the same directory. */
const install = () => {
  const directory = mkdtempSync(join(tmpdir(), "pochimail-basic-text-"));
  const secretsFile = join(directory, "secrets.json");
  const safeStorage = basicTextVault();
  const wrapCalls = vi.spyOn(safeStorage, "encryptStringAsync");
  const launch = () => {
    const gate = createStorageGate({
      vault: safeStorage,
      platform: "linux",
      directory,
      databaseFile: join(directory, "pochimail.db"),
      logger: createLogger({ sink: { write: () => undefined } }),
    });
    const vault = createSecretVault({
      vault: safeStorage,
      file: secretsFile,
      platform: "linux",
      passphraseKey: () => gate.passphraseKey(),
    });
    return { gate, vault };
  };
  return { launch, secretsFile, wrapCalls };
};

describe("OAuth tokens on Linux basic_text", () => {
  // Guards: users who chose a passphrase re-consenting on every launch because their tokens were never persisted.
  it("keeps tokens across a restart, sealed under the passphrase-derived key and never in plain text", async () => {
    const { launch, secretsFile, wrapCalls } = install();
    const first = launch();
    expect(await first.gate.setPassphrase(PASSPHRASE)).toBe("ready");
    expect((await first.vault.set("refresh-token", SECRET)).ok).toBe(true);

    const second = launch();
    expect(await second.gate.unlock(PASSPHRASE)).toBe("ready");
    expect(await second.vault.get("refresh-token")).toEqual({ ok: true, value: SECRET });
    expect(readFileSync(secretsFile, "utf8")).not.toContain(SECRET);
    expect(wrapCalls).not.toHaveBeenCalled();
  });

  // Guards: choosing no protection quietly persisting tokens under the hard-coded basic_text password (obfuscation).
  it("does not persist tokens when the person chose no protection", async () => {
    const { launch, secretsFile, wrapCalls } = install();
    const first = launch();
    expect(await first.gate.storeUnprotected()).toBe("ready");
    expect(await first.vault.set("refresh-token", SECRET)).toMatchObject({
      ok: false,
      error: { reason: "protection-unavailable" },
    });
    expect(() => readFileSync(secretsFile)).toThrow();
    expect(wrapCalls).not.toHaveBeenCalled();
  });

  // Guards: a token sealed for one entry being replayed under another, or read back after the file was edited.
  it("refuses a sealed entry moved to another name or altered", async () => {
    const { launch, secretsFile } = install();
    const { gate, vault } = launch();
    await gate.setPassphrase(PASSPHRASE);
    await vault.set("refresh-token", SECRET);
    const entries = JSON.parse(readFileSync(secretsFile, "utf8")).entries as Record<string, string>;
    const sealed = entries["refresh-token"] as string;
    writeFileSync(
      secretsFile,
      JSON.stringify({
        version: 1,
        entries: { other: sealed, "refresh-token": `${sealed.slice(0, -4)}AAAA` },
      }),
    );
    expect(await vault.get("other")).toMatchObject({ ok: false, error: { reason: "corrupted" } });
    expect(await vault.get("refresh-token")).toMatchObject({
      ok: false,
      error: { reason: "corrupted" },
    });
  });
});

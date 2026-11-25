import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { err, ok, type Result } from "@pochimail/kernel/result";
import { writeFileAtomic } from "./atomic-write.ts";

/** The slice of Electron's async `safeStorage` we use (the sync calls are deprecated); injectable so the key policy is testable without Electron. */
export type KeyVault = {
  isAsyncEncryptionAvailable: () => Promise<boolean>;
  encryptStringAsync: (plain: string) => Promise<Buffer>;
  decryptStringAsync: (cipher: Buffer) => Promise<{ result: string; shouldReEncrypt: boolean }>;
  /** Linux only: "basic_text", "gnome_libsecret", "kwallet5", ... */
  getSelectedStorageBackend?: () => string;
};

export type KeyProtection =
  | { level: "os-keychain"; backend: string }
  | { level: "basic-text" }
  | { level: "unavailable" };

/** Linux without a secret service falls back to a hard-coded password: that is obfuscation, not a secret (ADR 0005). */
export const keyProtection = async (
  vault: KeyVault,
  platform: NodeJS.Platform,
): Promise<KeyProtection> => {
  if (!(await vault.isAsyncEncryptionAvailable())) return { level: "unavailable" };
  if (platform !== "linux")
    return { level: "os-keychain", backend: platform === "darwin" ? "keychain" : "dpapi" };
  const backend = vault.getSelectedStorageBackend?.() ?? "unknown";
  return backend === "basic_text" || backend === "unknown"
    ? { level: "basic-text" }
    : { level: "os-keychain", backend };
};

/** Why the database key cannot be produced. Never carries key material. */
export class DatabaseKeyError extends Error {
  readonly reason: "key-file-invalid" | "key-missing-database-exists" | "choice-file-invalid";
  constructor(reason: DatabaseKeyError["reason"]) {
    super(`Database key: ${reason}`);
    this.name = "DatabaseKeyError";
    this.reason = reason;
  }
}

/**
 * Returns the 256-bit database key, creating it on first launch. It is only ever written wrapped by the OS keychain,
 * crash-safely. `ok(undefined)` means the keychain cannot protect it: the caller must warn and ask first (ADR 0005).
 * If the key file is gone but the database exists we never mint a new key (that would orphan the data): typed error.
 */
export const loadOrCreateDatabaseKey = async (
  vault: KeyVault,
  keyFile: string,
  platform: NodeJS.Platform,
  databaseFile: string,
): Promise<Result<Buffer | undefined, DatabaseKeyError>> => {
  if ((await keyProtection(vault, platform)).level !== "os-keychain") return ok(undefined);
  if (existsSync(keyFile)) {
    try {
      const { result, shouldReEncrypt } = await vault.decryptStringAsync(readFileSync(keyFile));
      if (!/^[0-9a-f]{64}$/i.test(result)) return err(new DatabaseKeyError("key-file-invalid"));
      if (shouldReEncrypt) writeFileAtomic(keyFile, await vault.encryptStringAsync(result));
      return ok(Buffer.from(result, "hex"));
    } catch {
      return err(new DatabaseKeyError("key-file-invalid"));
    }
  }
  if (existsSync(databaseFile)) return err(new DatabaseKeyError("key-missing-database-exists"));
  const key = randomBytes(32);
  writeFileAtomic(keyFile, await vault.encryptStringAsync(key.toString("hex")));
  return ok(key);
};

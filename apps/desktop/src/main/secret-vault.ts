import { existsSync, readFileSync } from "node:fs";
import { err, ok, type Result } from "@pochimail/kernel/result";
import type { Logger } from "@pochimail/logger/logger";
import { SecretStoreError } from "../shared/secret-error.ts";
import { writeFileAtomic } from "./atomic-write.ts";
import { isSealed, seal, unseal } from "./secret-seal.ts";
import { type KeyProtection, type KeyVault, keyProtection } from "./storage-key.ts";

export type SecretVault = {
  get: (key: string) => Promise<Result<string | null, SecretStoreError>>;
  set: (key: string, value: string) => Promise<Result<void, SecretStoreError>>;
  remove: (key: string) => Promise<Result<void, SecretStoreError>>;
  /** What the OS can do for us right now; onboarding (M4-20) reads it to ask the user about `basic-text`. */
  protection: () => Promise<KeyProtection>;
};

type Entries = Record<string, string>;

/**
 * Main-process owner of the secrets file. Each value is wrapped by the OS keychain (async `safeStorage`) before it
 * touches the disk. On `basic-text` (Linux without a secret service) the wrap is only obfuscation, so a value is
 * stored only when the person chose a passphrase: it is then sealed under a subkey of the passphrase-derived key
 * (`passphraseKey`). With no protection chosen, or `unavailable`, nothing is ever written. Values never reach a log or an error.
 */
export const createSecretVault = (options: {
  vault: KeyVault;
  file: string;
  platform: NodeJS.Platform;
  /** A copy of the passphrase-derived database key, or `undefined` when the person did not choose a passphrase. The vault zeroes it. */
  passphraseKey?: () => Promise<Buffer | undefined>;
  logger?: Logger;
}): SecretVault => {
  const { vault, file, platform, logger } = options;
  const passphraseKey = options.passphraseKey ?? (async () => undefined);
  // Reads and writes are serialized so two concurrent `set` calls never lose one another's entry.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const next = queue.then(task, task);
    queue = next.catch(() => undefined);
    return next;
  };
  const fail = (operation: string, error: SecretStoreError): Result<never, SecretStoreError> => {
    logger?.warn(`secret store ${operation} failed (${error.reason.replaceAll("-", " ")})`, {
      code: "storage.failed",
    });
    return err(error);
  };

  const load = (): Entries | undefined => {
    if (!existsSync(file)) return {};
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (typeof parsed !== "object" || parsed === null) return undefined;
      const entries = (parsed as { entries?: unknown }).entries;
      if (typeof entries !== "object" || entries === null) return undefined;
      const result: Entries = {};
      for (const [name, wrapped] of Object.entries(entries)) {
        if (typeof wrapped !== "string") return undefined;
        result[name] = wrapped;
      }
      return result;
    } catch {
      return undefined;
    }
  };
  const save = (entries: Entries): void =>
    writeFileAtomic(file, JSON.stringify({ version: 1, entries }));
  /** The value as it goes to disk, or `undefined` when no protection that is more than obfuscation is available. */
  const wrap = async (name: string, value: string): Promise<string | undefined> => {
    const { level } = await keyProtection(vault, platform);
    if (level === "os-keychain") return (await vault.encryptStringAsync(value)).toString("base64");
    if (level !== "basic-text") return undefined;
    const key = await passphraseKey();
    if (key === undefined) return undefined;
    try {
      return seal(key, name, value);
    } finally {
      key.fill(0);
    }
  };
  /** The plain value, or `undefined` when no key can open this entry now. Throws on damage. */
  const unwrap = async (name: string, stored: string): Promise<string | undefined> => {
    if (!isSealed(stored)) {
      if ((await keyProtection(vault, platform)).level === "unavailable") return undefined;
      const { result, shouldReEncrypt } = await vault.decryptStringAsync(
        Buffer.from(stored, "base64"),
      );
      // Re-wrapping is a write: it follows the same rule as `set` (never on basic_text without a passphrase).
      const rewrapped = shouldReEncrypt ? await wrap(name, result) : undefined;
      if (rewrapped !== undefined) save({ ...load(), [name]: rewrapped });
      return result;
    }
    const key = await passphraseKey();
    if (key === undefined) return undefined;
    try {
      return unseal(key, name, stored);
    } finally {
      key.fill(0);
    }
  };

  return {
    protection: () => keyProtection(vault, platform),
    get: (key) =>
      serial(async () => {
        const entries = load();
        if (entries === undefined) return fail("get", new SecretStoreError("corrupted"));
        const wrapped = entries[key];
        if (wrapped === undefined) return ok(null);
        try {
          const value = await unwrap(key, wrapped);
          return value === undefined
            ? fail("get", new SecretStoreError("protection-unavailable"))
            : ok(value);
        } catch {
          return fail("get", new SecretStoreError("corrupted"));
        }
      }),
    set: (key, value) =>
      serial(async () => {
        const entries = load();
        if (entries === undefined) return fail("set", new SecretStoreError("corrupted"));
        try {
          const wrapped = await wrap(key, value);
          if (wrapped === undefined)
            return fail("set", new SecretStoreError("protection-unavailable"));
          entries[key] = wrapped;
          save(entries);
          return ok(undefined);
        } catch {
          return fail("set", new SecretStoreError("failed"));
        }
      }),
    remove: (key) =>
      serial(async () => {
        const entries = load();
        if (entries === undefined) return fail("remove", new SecretStoreError("corrupted"));
        if (!(key in entries)) return ok(undefined);
        try {
          delete entries[key];
          save(entries);
          return ok(undefined);
        } catch {
          return fail("remove", new SecretStoreError("failed"));
        }
      }),
  };
};

import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { fakeVault } from "../test-support/fake-key-vault.ts";
import {
  DatabaseKeyError,
  type KeyVault,
  keyProtection,
  loadOrCreateDatabaseKey,
} from "./storage-key.ts";

const dbFor = (file: string) => join(dirname(file), "pochimail.db");
/** Value of a successful load, or the typed error. */
const load = async (vault: KeyVault, file: string, platform: NodeJS.Platform) => {
  const result = await loadOrCreateDatabaseKey(vault, file, platform, dbFor(file));
  return result.ok ? result.value : result.error;
};
const keyFile = () => join(mkdtempSync(join(tmpdir(), "pochimail-key-")), "db.key");

describe("database key", () => {
  // Guards: the raw key landing in a file, or a new key on every launch (which would lock the user out of their data).
  it("is stored wrapped, and the same key comes back on the next launch", async () => {
    const file = keyFile();
    const first = await load(fakeVault(), file, "darwin");
    expect(first).toHaveLength(32);
    const stored = readFileSync(file);
    expect(stored.toString().startsWith("wrapped:")).toBe(true);
    expect(stored.includes(first instanceof Buffer ? first : Buffer.alloc(0))).toBe(false); // the raw 32 bytes are not in the file
    expect(await load(fakeVault(), file, "darwin")).toEqual(first);
  });

  // Guards: silently writing the key under Linux's hard-coded basic_text password; the app must ask the user first.
  it("refuses to store the key when Linux falls back to basic_text", async () => {
    const vault = fakeVault({ getSelectedStorageBackend: () => "basic_text" });
    expect(await keyProtection(vault, "linux")).toEqual({ level: "basic-text" });
    const file = keyFile();
    expect(await load(vault, file, "linux")).toBeUndefined();
    expect(existsSync(file)).toBe(false);
  });

  it("accepts a real Linux secret service", async () => {
    const vault = fakeVault({ getSelectedStorageBackend: () => "gnome_libsecret" });
    expect(await keyProtection(vault, "linux")).toEqual({
      level: "os-keychain",
      backend: "gnome_libsecret",
    });
  });

  it("reports an unavailable keychain", async () => {
    const vault = fakeVault({ isAsyncEncryptionAvailable: async () => false });
    expect(await load(vault, keyFile(), "win32")).toBeUndefined();
  });

  // Guards: a truncated/garbled key file being accepted (Buffer.from(hex) silently truncates) and used as a weak key.
  it("rejects a key file that does not hold exactly 32 bytes of hex", async () => {
    for (const bad of ["zz".repeat(32), "ab".repeat(16), "ab".repeat(33), ""]) {
      const file = keyFile();
      writeFileSync(file, Buffer.from(`wrapped:${bad}`));
      expect(await load(fakeVault(), file, "darwin")).toMatchObject({ reason: "key-file-invalid" });
    }
    const garbage = keyFile();
    writeFileSync(garbage, "not wrapped at all");
    expect(await load(fakeVault(), garbage, "darwin")).toBeInstanceOf(DatabaseKeyError);
  });

  // Guards: a deleted db.key silently minting a new key, which would orphan the existing encrypted database forever.
  it("never generates a new key when the database exists but the key file is gone", async () => {
    const file = keyFile();
    writeFileSync(dbFor(file), "existing encrypted data");
    expect(await load(fakeVault(), file, "darwin")).toMatchObject({
      reason: "key-missing-database-exists",
    });
    expect(existsSync(file)).toBe(false);
  });

  // Guards: the re-encrypt path overwriting the only copy of the key in place, or a world-readable key file.
  it("re-wraps the key atomically and keeps the file private", async () => {
    const file = keyFile();
    const first = await load(fakeVault(), file, "darwin");
    const reWrapping = fakeVault({
      decryptStringAsync: async (cipher) => ({
        result: cipher.toString().replace("wrapped:", ""),
        shouldReEncrypt: true,
      }),
      encryptStringAsync: async () => {
        throw new Error("keychain failed mid re-encrypt");
      },
    });
    expect(await load(reWrapping, file, "darwin")).toMatchObject({ reason: "key-file-invalid" });
    expect(await load(fakeVault(), file, "darwin")).toEqual(first); // old copy intact
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });
});

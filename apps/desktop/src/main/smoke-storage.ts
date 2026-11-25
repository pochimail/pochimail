import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UtilityProcess } from "electron";
import { type KeyVault, keyProtection, loadOrCreateDatabaseKey } from "./storage-key.ts";

/** Packaging smoke (M0-12): key from safeStorage, then the encrypted-database proof inside a utilityProcess of the packaged app. */
export const smokeStorage = async (options: {
  vault: KeyVault;
  fork: () => UtilityProcess;
  /** Where the wrapped key lives. The packaging smoke keeps it across two launches to prove the keychain returns the same key after a restart. */
  keyFile?: string | undefined;
}): Promise<void> => {
  const dir = mkdtempSync(join(tmpdir(), "pochimail-smoke-"));
  const protection = await keyProtection(options.vault, process.platform);
  const keyFile = options.keyFile ?? join(dir, "db.key");
  const source = existsSync(keyFile) ? "read" : "created";
  // Without a keychain (Linux basic_text) the real app must ask first; the smoke still proves the driver with a throwaway key.
  const loaded = await loadOrCreateDatabaseKey(
    options.vault,
    keyFile,
    process.platform,
    join(dir, "smoke.db"),
  );
  const keychainKey = loaded.ok ? loaded.value : undefined;
  const key = keychainKey ?? randomBytes(32);
  // A fingerprint of the throwaway smoke key, never the key: it lets the next launch compare what the keychain returned.
  const keyCheck =
    keychainKey === undefined
      ? undefined
      : { source, sha256: createHash("sha256").update(keychainKey).digest("hex") };
  const child = options.fork();
  try {
    const result = await new Promise<unknown>((resolve) => {
      child.once("message", resolve);
      child.once("exit", (code) =>
        resolve({ ok: false, error: `storage worker exited with ${code}` }),
      );
      child.postMessage({
        path: join(dir, "smoke.db"),
        keyHex: key.toString("hex"),
        rows: 100_000,
      });
    });
    process.stdout.write(`smoke:storage ${JSON.stringify({ protection, result, keyCheck })}\n`);
  } finally {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
};

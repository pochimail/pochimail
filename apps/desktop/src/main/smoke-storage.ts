import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UtilityProcess } from "electron";
import { type KeyVault, keyProtection, loadOrCreateDatabaseKey } from "./storage-key.ts";

/** Packaging smoke (M0-12): key from safeStorage, then the encrypted-database proof inside a utilityProcess of the packaged app. */
export const smokeStorage = async (options: {
  vault: KeyVault;
  fork: () => UtilityProcess;
}): Promise<void> => {
  const dir = mkdtempSync(join(tmpdir(), "pochimail-smoke-"));
  const protection = await keyProtection(options.vault, process.platform);
  // Without a keychain (Linux basic_text) the real app must ask first; the smoke still proves the driver with a throwaway key.
  const loaded = await loadOrCreateDatabaseKey(
    options.vault,
    join(dir, "db.key"),
    process.platform,
    join(dir, "smoke.db"),
  );
  const key = (loaded.ok ? loaded.value : undefined) ?? randomBytes(32);
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
    process.stdout.write(`smoke:storage ${JSON.stringify({ protection, result })}\n`);
  } finally {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
};

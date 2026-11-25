import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeFileAtomic } from "./atomic-write.ts";

describe("atomic write", () => {
  // Guards: a stale world-readable temp file (a crash leftover or a planted one) keeping its mode, so the key written
  // through it would be readable by other users.
  it.skipIf(process.platform === "win32")("writes at 0600 even over a stale 0644 temp file", () => {
    const file = join(mkdtempSync(join(tmpdir(), "pochimail-atomic-")), "db.key.plain");
    writeFileSync(`${file}.tmp`, "stale", { mode: 0o644 });
    writeFileAtomic(file, "fresh");
    expect(readFileSync(file, "utf8")).toBe("fresh");
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});

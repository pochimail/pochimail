import { closeSync, fsyncSync, openSync, renameSync, rmSync, writeSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Crash-safe replace: write a temp file, fsync it, rename over the target, then fsync the directory (not possible
 * on Windows). A crash leaves either the old file or the new one, never a torn one. A stale temp file is removed first
 * and the new one created exclusively, so its mode is ours and nobody holds a handle to it.
 */
export const writeFileAtomic = (path: string, data: string | Buffer, mode = 0o600): void => {
  const temp = `${path}.tmp`;
  rmSync(temp, { force: true });
  const fd = openSync(temp, "wx", mode);
  try {
    writeSync(fd, typeof data === "string" ? Buffer.from(data) : data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, path);
  if (process.platform === "win32") return;
  const dir = openSync(dirname(path), "r");
  try {
    fsyncSync(dir);
  } finally {
    closeSync(dir);
  }
};

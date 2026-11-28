import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Mounts a dmg read-only, hands the path of the .app inside to `use`, and always detaches. */
export const withMountedDmg = async <T>(
  dmg: string,
  use: (appPath: string) => Promise<T> | T,
): Promise<T> => {
  const mountPoint = mkdtempSync(join(tmpdir(), "pochimail-dmg-"));
  execFileSync("hdiutil", ["attach", "-nobrowse", "-readonly", "-mountpoint", mountPoint, dmg], {
    stdio: "inherit",
  });
  try {
    const app = readdirSync(mountPoint).find((name) => name.endsWith(".app"));
    if (app === undefined) throw new Error("No .app inside the dmg");
    return await use(join(mountPoint, app));
  } finally {
    execFileSync("hdiutil", ["detach", "-force", mountPoint], { stdio: "inherit" });
    rmSync(mountPoint, { recursive: true, force: true });
  }
};

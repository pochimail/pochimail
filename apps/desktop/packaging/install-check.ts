import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installPlan } from "./install-plan.ts";
import { launchSmoke } from "./launch-smoke.ts";
import { releaseOsOf } from "./release-assets.ts";
import { signingFor } from "./signing-mode.ts";
import { verifySignature } from "./verify-signature.ts";

/**
 * CI step: installs each artifact this OS ships the way a person would, launches it, and checks that its window loads and that
 * it reports the version in package.json. Signature checks run only on a signed build (the signing mode of #298).
 */
const appDir = join(import.meta.dirname, "..");
const os = releaseOsOf(process.platform);
const expected = (
  JSON.parse(readFileSync(join(appDir, "package.json"), "utf8")) as { version: string }
).version;
const mode = os === "linux" ? "unsigned" : signingFor(os, process.env).mode;
const root = mkdtempSync(join(tmpdir(), "pochimail-install-"));

const run = (file: string, args: readonly string[]): void => {
  execFileSync(file, [...args], { stdio: "inherit" });
};

const waitForFile = async (path: string): Promise<void> => {
  for (let i = 0; i < 120 && !existsSync(path); i += 1)
    await new Promise((resolve) => setTimeout(resolve, 500));
  if (!existsSync(path)) throw new Error(`Not installed: ${path} never appeared`);
};

try {
  for (const install of installPlan(os, join(appDir, "release"), root)) {
    console.log(`install: ${install.artifact}`);
    try {
      for (const { file, args } of install.setup) run(file, args);
      await waitForFile(install.binary);
      const { code, output } = await launchSmoke(install.binary, install.env);
      const version = /smoke:window-loaded version=(\S+)/.exec(output)?.[1];
      if (code !== 0 || version === undefined)
        throw new Error(`${install.artifact} did not start (exit ${code}). Output: ${output}`);
      if (version !== expected)
        throw new Error(`${install.artifact} reports version ${version}, expected ${expected}`);
      console.log(`launch: ok, version ${version}`);
      if (install.signatureTarget !== undefined) verifySignature(os, mode, install.signatureTarget);
    } finally {
      for (const { file, args } of install.teardown) run(file, args);
    }
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

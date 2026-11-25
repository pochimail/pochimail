import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { withMountedDmg } from "./dmg.ts";
import { RELEASE_ASSETS, releaseOsOf } from "./release-assets.ts";
import { type SignaturePlan, signaturePlan } from "./signature-plan.ts";
import { signingFor } from "./signing-mode.ts";

/** Release workflow step: this OS's installers exist, and their signature checks pass when the build is signed (skipped, said so, when it is not). */
const releaseDir = join(import.meta.dirname, "..", "release");
const os = releaseOsOf(process.platform);
const missing = RELEASE_ASSETS[os].filter((name) => !existsSync(join(releaseDir, name)));
if (missing.length > 0) throw new Error(`Missing release artifacts: ${missing.join(", ")}`);
console.log(`artifacts: ${RELEASE_ASSETS[os].join(", ")}`);

const mode = os === "linux" ? "unsigned" : signingFor(os, process.env).mode;
const run = (plan: SignaturePlan): void => {
  if ("skip" in plan) {
    console.log(plan.skip);
    return;
  }
  for (const { file, args } of plan.commands) execFileSync(file, [...args], { stdio: "inherit" });
  console.log("signature: ok");
};

const [installer] = RELEASE_ASSETS[os];
const installerPath = join(releaseDir, installer);
if (os === "mac") await withMountedDmg(installerPath, (app) => run(signaturePlan(os, mode, app)));
else run(signaturePlan(os, mode, installerPath));

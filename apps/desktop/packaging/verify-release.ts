import { existsSync } from "node:fs";
import { join } from "node:path";
import { withMountedDmg } from "./dmg.ts";
import { RELEASE_ASSETS, releaseOsOf } from "./release-assets.ts";
import { signingFor } from "./signing-mode.ts";
import { verifySignature } from "./verify-signature.ts";

/** Release workflow step: this OS's installers exist, and their signature checks pass when the build is signed (skipped, said so, when it is not). */
const releaseDir = join(import.meta.dirname, "..", "release");
const os = releaseOsOf(process.platform);
const missing = RELEASE_ASSETS[os].filter((name) => !existsSync(join(releaseDir, name)));
if (missing.length > 0) throw new Error(`Missing release artifacts: ${missing.join(", ")}`);
console.log(`artifacts: ${RELEASE_ASSETS[os].join(", ")}`);

const mode = os === "linux" ? "unsigned" : signingFor(os, process.env).mode;
const [installer] = RELEASE_ASSETS[os];
const installerPath = join(releaseDir, installer);
if (os === "mac") await withMountedDmg(installerPath, (app) => verifySignature(os, mode, app));
else verifySignature(os, mode, installerPath);

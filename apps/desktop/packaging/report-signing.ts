import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { signingFor, signingLine } from "./signing-mode.ts";

/** Release workflow step: prints the signing line for one OS, records the mode for the release notes, fails on partial secrets. */
const os = process.argv[2];
if (os !== "mac" && os !== "windows" && os !== "linux")
  throw new Error("Usage: report-signing.ts <mac|windows|linux>");

if (os === "linux") console.log("Linux builds are never signed");
else {
  const status = signingFor(os, process.env);
  console.log(signingLine(os, status));
  if (status.mode === "invalid") throw new Error(signingLine(os, status));
  const releaseDir = join(import.meta.dirname, "..", "release");
  mkdirSync(releaseDir, { recursive: true });
  writeFileSync(join(releaseDir, `signing-${os}.txt`), status.mode);
}

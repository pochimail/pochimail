import { assembleRelease } from "./assemble-release.ts";

/** Publish job step: `node finalize-release.ts <dir holding the five installers and signing-*.txt> <version>`. */
const [dir, version] = process.argv.slice(2);
if (dir === undefined || version === undefined)
  throw new Error("Usage: finalize-release.ts <dir> <version>");
assembleRelease(dir, version);
console.log(`Release files ready in ${dir}`);

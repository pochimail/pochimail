import { readFileSync, writeFileSync } from "node:fs";
import { rimPng } from "./mascot-rim.ts";

// Run from the repo root (`pnpm mascot:rim`) after the night pose art changes.
const assets = new URL("../../../packages/ui/src/assets/mascot/", import.meta.url);
const result = rimPng(readFileSync(new URL("pochi-night@2x.png", assets)));
if (!result.ok) {
  console.error(`mascot rim: ${result.reason}`);
  process.exit(1);
}
writeFileSync(new URL("pochi-night-rim@2x.png", assets), result.png);
console.log("wrote packages/ui/src/assets/mascot/pochi-night-rim@2x.png");

import { execFileSync } from "node:child_process";
import type { ReleaseOs } from "./release-assets.ts";
import { signaturePlan } from "./signature-plan.ts";
import type { SigningMode } from "./signing-mode.ts";

/** Runs the signature checks of one artifact, or prints why they are skipped. A failing check throws. */
export const verifySignature = (os: ReleaseOs, mode: SigningMode, target: string): void => {
  const plan = signaturePlan(os, mode, target);
  if ("skip" in plan) {
    console.log(plan.skip);
    return;
  }
  for (const { file, args } of plan.commands) execFileSync(file, [...args], { stdio: "inherit" });
  console.log("signature: ok");
};

import type { ReleaseOs } from "./release-assets.ts";
import type { SigningMode } from "./signing-mode.ts";

type Command = { readonly file: string; readonly args: readonly string[] };
export type SignaturePlan = { readonly skip: string } | { readonly commands: readonly Command[] };

const powershellString = (value: string): string => `'${value.replaceAll("'", "''")}'`;

/**
 * The signature checks for one artifact (the unpacked .app on macOS, the installer on Windows), decided by the
 * signing mode alone: a signed build must prove its signature, an unsigned one says the checks are skipped.
 */
export const signaturePlan = (os: ReleaseOs, mode: SigningMode, target: string): SignaturePlan => {
  if (os === "linux") return { skip: "Linux builds are never signed: signature checks skipped" };
  if (mode === "invalid") throw new Error("Signing mode is invalid: refusing to verify");
  if (mode === "unsigned") return { skip: `${os} build is unsigned: signature checks skipped` };
  if (os === "mac")
    return {
      commands: [
        { file: "codesign", args: ["--verify", "--deep", "--strict", "--verbose=2", target] },
        { file: "spctl", args: ["--assess", "--type", "execute", "--verbose=2", target] },
        { file: "xcrun", args: ["stapler", "validate", target] },
      ],
    };
  return {
    commands: [
      {
        file: "powershell",
        args: [
          "-NoProfile",
          "-Command",
          `if ((Get-AuthenticodeSignature -LiteralPath ${powershellString(target)}).Status -ne 'Valid') { exit 1 }`,
        ],
      },
    ],
  };
};

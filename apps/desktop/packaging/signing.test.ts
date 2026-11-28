import { describe, expect, it } from "vitest";
import { buildConfig } from "../electron-builder.config.ts";
import { signaturePlan } from "./signature-plan.ts";
import {
  SIGNING_SECRETS,
  type SigningOs,
  signingFor,
  signingLine,
  signingStatus,
} from "./signing-mode.ts";

const fake = (os: SigningOs): Record<string, string> =>
  Object.fromEntries(SIGNING_SECRETS[os].map((name) => [name, "fake-value"]));
const release = { POCHIMAIL_RELEASE_BUILD: "1" };

describe("signing mode", () => {
  // Guards: a release that silently builds unsigned because one secret is missing or empty.
  it("is signed with all secrets, unsigned with none, invalid with some", () => {
    expect(signingStatus("mac", fake("mac")).mode).toBe("signed");
    expect(signingStatus("windows", fake("windows")).mode).toBe("signed");
    expect(signingStatus("mac", {}).mode).toBe("unsigned");
    expect(signingStatus("mac", { CSC_LINK: "", APPLE_ID: "" }).mode).toBe("unsigned");
    const partial = signingStatus("mac", { CSC_LINK: "x", APPLE_ID: "y" });
    expect(partial.mode).toBe("invalid");
    expect(partial.missing).toEqual([
      "CSC_KEY_PASSWORD",
      "APPLE_APP_SPECIFIC_PASSWORD",
      "APPLE_TEAM_ID",
    ]);
  });

  // Guards: a partial-secrets message that hides which names to add, or prints a secret value.
  it("names the missing secrets and never a value", () => {
    const line = signingLine(
      "windows",
      signingStatus("windows", { AZURE_TENANT_ID: "do-not-print" }),
    );
    expect(line).toContain("AZURE_CLIENT_ID");
    expect(line).not.toContain("do-not-print");
    expect(signingLine("mac", signingStatus("mac", {}))).toBe(
      "macOS signing skipped: secrets not set, building an unsigned app",
    );
  });

  // Guards: a pull request or merge-queue build that signs because secrets happen to be in the environment.
  it("keeps every build unsigned unless it is a release build", () => {
    expect(signingFor("mac", fake("mac")).mode).toBe("unsigned");
    expect(signingFor("mac", { ...release, ...fake("mac") }).mode).toBe("signed");
  });
});

describe("electron-builder config", () => {
  // Guards: PR builds picking up the signing identity, or a release with secrets not signing at all.
  it("enables macOS signing and the Windows step only for a release build with all secrets", () => {
    const unsigned = buildConfig({ ...fake("mac"), ...fake("windows") });
    expect(unsigned.mac?.identity).toBeNull();
    expect(unsigned.win?.azureSignOptions).toBeUndefined();

    const signed = buildConfig({ ...release, ...fake("mac"), ...fake("windows") });
    expect(signed.mac).toMatchObject({ hardenedRuntime: true, notarize: true });
    expect(signed.mac?.identity).toBeUndefined();
    expect(signed.win?.azureSignOptions).toBeDefined();

    const none = buildConfig(release);
    expect(none.mac?.identity).toBeNull();
    expect(none.win?.azureSignOptions).toBeUndefined();
  });

  // Guards: a release that falls back to unsigned after a typo in one secret name.
  it("fails a release build when an OS has only some of its secrets", () => {
    expect(() => buildConfig({ ...release, CSC_LINK: "x" })).toThrow(/CSC_KEY_PASSWORD/);
  });

  // Guards: an updater sneaking back (zip, publish feed): v1 only notices new versions.
  it("ships only the dmg on macOS and has no publish feed", () => {
    const config = buildConfig({});
    expect(config.mac?.target).toEqual([{ target: "dmg", arch: "universal" }]);
    expect(config).not.toHaveProperty("publish");
  });
});

describe("signature checks", () => {
  // Guards: an unsigned build failing its signature checks, or a signed build skipping them.
  it("skips on unsigned builds and on Linux, and runs the OS checks when signed", () => {
    expect(signaturePlan("mac", "unsigned", "/x/Pochimail.app")).toEqual({
      skip: "mac build is unsigned: signature checks skipped",
    });
    expect(signaturePlan("linux", "signed", "x.AppImage")).toHaveProperty("skip");
    const mac = signaturePlan("mac", "signed", "/x/Pochimail.app");
    expect("commands" in mac && mac.commands.map((c) => c.args.join(" "))).toEqual([
      "--verify --deep --strict --verbose=2 /x/Pochimail.app",
      "--assess --type execute --verbose=2 /x/Pochimail.app",
      "stapler validate /x/Pochimail.app",
    ]);
    const windows = signaturePlan("windows", "signed", "C:\\it's.exe");
    expect("commands" in windows && windows.commands[0]?.args.join(" ")).toContain(
      "'C:\\it''s.exe'",
    );
  });

  // Guards: verifying a build whose secrets are half set.
  it("refuses an invalid mode", () => {
    expect(() => signaturePlan("windows", "invalid", "x.exe")).toThrow(/invalid/);
  });
});

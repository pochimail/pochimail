import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installPlan } from "./install-plan.ts";
import { allReleaseAssets, RELEASE_ASSETS } from "./release-assets.ts";
import { verifySignature } from "./verify-signature.ts";

afterEach(() => vi.restoreAllMocks());

describe("install plan", () => {
  // Guards: a shipped artifact type that CI never installs, so a broken installer ships with all checks green.
  it("installs every artifact the release ships, once", () => {
    const installed = (["mac", "windows", "linux"] as const).flatMap((os) =>
      installPlan(os, "/release", "/scratch").map((install) => install.artifact),
    );
    expect(installed.sort()).toEqual([...allReleaseAssets()].sort());
  });

  // Guards: the NSIS installer prompting (no /S) or putting the app where the check does not look.
  it("installs the NSIS exe silently into the folder it then launches", () => {
    const [install] = installPlan("windows", "/release", "/scratch");
    const dir = join("/scratch", "Pochimail");
    expect(install?.setup[0]?.args).toEqual(["/S", `/D=${dir}`]);
    expect(install?.binary).toBe(join(dir, "Pochimail.exe"));
  });

  // Guards: the deb and rpm both landing in /opt/Pochimail so the second one is checked against the first one's files.
  it("removes the deb before the rpm is installed, and runs the AppImage without FUSE", () => {
    const [appImage, deb, rpm] = installPlan("linux", "/release", "/scratch");
    expect(appImage?.env).toEqual({ APPIMAGE_EXTRACT_AND_RUN: "1" });
    expect(deb?.binary).toBe(rpm?.binary);
    expect(deb?.teardown).toHaveLength(1);
    expect(rpm?.setup[0]?.args).toContain(join("/release", RELEASE_ASSETS.linux[2]));
  });

  // Guards: signature checks aimed at the dmg file instead of the app inside it.
  it("points the macOS signature checks at the installed app", () => {
    const [install] = installPlan("mac", "/release", "/scratch");
    expect(install?.signatureTarget).toBe(join("/scratch", "Pochimail.app"));
    expect(installPlan("linux", "/release", "/scratch").map((i) => i.signatureTarget)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("signature verification step", () => {
  // Guards: an unsigned build failing its install job, with no message saying the checks were skipped.
  it("is skipped with a clear message on an unsigned build", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(() => verifySignature("mac", "unsigned", "/nope/Pochimail.app")).not.toThrow();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("signature checks skipped"));
  });

  // Guards: a build that should be signed passing with no signature (the checks must run, and fail here).
  it("runs the checks on a signed build and fails when they do", () => {
    expect(() => verifySignature("mac", "signed", "/nope/Pochimail.app")).toThrow();
    expect(() => verifySignature("windows", "invalid", "x.exe")).toThrow(/invalid/);
  });
});

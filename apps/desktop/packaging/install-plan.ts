import { join } from "node:path";
import { RELEASE_ASSETS, type ReleaseOs } from "./release-assets.ts";
import type { Command } from "./signature-plan.ts";

/** One shipped artifact, installed the way a person installs it, then launched. */
export type Install = {
  readonly artifact: string;
  /** Commands that install it. */
  readonly setup: readonly Command[];
  /** The installed app's executable, which the smoke launch starts. */
  readonly binary: string;
  /** What the signature checks look at when the build is signed: the installed app (macOS) or the installer (Windows). */
  readonly signatureTarget: string | undefined;
  readonly env: Readonly<Record<string, string>>;
  /** Commands that remove it again, so the next artifact starts from a clean machine. */
  readonly teardown: readonly Command[];
};

const bash = (script: string): Command => ({ file: "bash", args: ["-c", script] });

/**
 * The install step of every artifact this OS ships: the dmg is mounted and its app copied, the NSIS installer runs silently,
 * the deb and rpm are installed with the system tools, and the AppImage is run in place. All of them land in `root`, a
 * scratch folder, except the Linux packages, which install to /opt as they do for a person.
 */
export const installPlan = (os: ReleaseOs, artifactDir: string, root: string): Install[] => {
  const path = (name: string): string => join(artifactDir, name);
  if (os === "mac") {
    const [dmg] = RELEASE_ASSETS.mac;
    const mount = join(root, "mount");
    const app = join(root, "Pochimail.app");
    return [
      {
        artifact: dmg,
        setup: [
          { file: "mkdir", args: [mount] },
          {
            file: "hdiutil",
            args: ["attach", "-nobrowse", "-readonly", "-mountpoint", mount, path(dmg)],
          },
          { file: "ditto", args: [join(mount, "Pochimail.app"), app] },
          { file: "hdiutil", args: ["detach", "-force", mount] },
        ],
        binary: join(app, "Contents", "MacOS", "Pochimail"),
        signatureTarget: app,
        env: {},
        teardown: [],
      },
    ];
  }
  if (os === "windows") {
    const [installer] = RELEASE_ASSETS.windows;
    const dir = join(root, "Pochimail");
    return [
      {
        artifact: installer,
        // `/D=` must be the last argument and takes no quotes.
        setup: [{ file: path(installer), args: ["/S", `/D=${dir}`] }],
        binary: join(dir, "Pochimail.exe"),
        signatureTarget: path(installer),
        env: {},
        teardown: [],
      },
    ];
  }
  const [appImage, deb, rpm] = RELEASE_ASSETS.linux;
  const installed = "/opt/Pochimail/pochimail";
  return [
    {
      artifact: appImage,
      setup: [{ file: "chmod", args: ["+x", path(appImage)] }],
      binary: path(appImage),
      signatureTarget: undefined,
      // No FUSE on a CI runner: the AppImage unpacks itself and runs from there.
      env: { APPIMAGE_EXTRACT_AND_RUN: "1" },
      teardown: [],
    },
    {
      artifact: deb,
      setup: [{ file: "sudo", args: ["apt-get", "install", "-y", path(deb)] }],
      binary: installed,
      signatureTarget: undefined,
      env: {},
      teardown: [bash(`sudo apt-get remove -y "$(dpkg-deb -f '${path(deb)}' Package)"`)],
    },
    {
      artifact: rpm,
      setup: [{ file: "sudo", args: ["rpm", "-i", "--nodeps", "--nosignature", path(rpm)] }],
      binary: installed,
      signatureTarget: undefined,
      env: {},
      teardown: [bash(`sudo rpm -e --nodeps "$(rpm -qp --qf '%{NAME}' '${path(rpm)}')"`)],
    },
  ];
};

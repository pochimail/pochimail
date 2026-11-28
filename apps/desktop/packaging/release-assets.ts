import { createHash } from "node:crypto";

/**
 * The five files a release ships. Names carry no version, so `releases/latest/download/<name>` always works
 * (the website links them). electron-builder.config.ts takes its artifact names from here.
 */
export const RELEASE_ASSETS = {
  mac: ["Pochimail-mac-universal.dmg"],
  windows: ["Pochimail-win-x64.exe"],
  linux: [
    "Pochimail-linux-x86_64.AppImage",
    "Pochimail-linux-amd64.deb",
    "Pochimail-linux-x86_64.rpm",
  ],
} as const;

export type ReleaseOs = keyof typeof RELEASE_ASSETS;

export const releaseOsOf = (platform: string): ReleaseOs => {
  const os = ({ darwin: "mac", win32: "windows", linux: "linux" } as const)[
    platform as "darwin" | "win32" | "linux"
  ];
  if (os === undefined) throw new Error(`Unsupported platform for a release: ${platform}`);
  return os;
};

export const allReleaseAssets = (): string[] => Object.values(RELEASE_ASSETS).flat();

/** Strict `vX.Y.Z` only: pre-release tags never publish (GitHub's "latest" skips them anyway). */
export const versionFromTag = (tag: string): string => {
  const match = /^v(\d+\.\d+\.\d+)$/.exec(tag);
  if (match?.[1] === undefined) throw new Error(`Not a release tag (expected vX.Y.Z): ${tag}`);
  return match[1];
};

/** The update notice reads this file (#300): the version and nothing else. */
export const latestJson = (version: string): string => `${JSON.stringify({ version })}\n`;

export const sha256 = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");

/** `sha256sum` format, sorted, one line per asset. */
export const checksumFile = (entries: readonly { name: string; hash: string }[]): string =>
  `${[...entries]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ name, hash }) => `${hash}  ${name}`)
    .join("\n")}\n`;

export type SigningModes = Readonly<Record<"mac" | "windows", string>>;

/** Release notes: which artifacts are unsigned, and how to check a download. */
export const releaseNotes = (version: string, modes: SigningModes): string => {
  const unsigned = (["mac", "windows"] as const).filter((os) => modes[os] !== "signed");
  const names = (os: "mac" | "windows"): string => RELEASE_ASSETS[os].join(", ");
  const lines = [`Pochimail ${version}`, ""];
  if (unsigned.length === 0) lines.push("All macOS and Windows installers are code-signed.");
  else {
    lines.push("**These builds are not code-signed.** Your OS will warn before the first launch.");
    for (const os of unsigned) lines.push(`- ${os === "mac" ? "macOS" : "Windows"}: ${names(os)}`);
  }
  lines.push(
    "- Linux builds are never signed.",
    "",
    "Check a download against `SHA256SUMS` (`sha256sum -c SHA256SUMS --ignore-missing`).",
  );
  return `${lines.join("\n")}\n`;
};

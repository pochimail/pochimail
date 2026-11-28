import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Installers worth reporting: blockmaps and update metadata are not downloads users pick. */
const installerPattern = /\.(dmg|exe|AppImage|deb|rpm)$/;

const formatMegabytes = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export const sizeTable = (title: string, files: { name: string; bytes: number }[]): string => {
  const rows = files
    .filter(({ name }) => installerPattern.test(name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ name, bytes }) => `| ${name} | ${formatMegabytes(bytes)} |`);
  if (rows.length === 0) throw new Error("No installer artifacts found to report");
  return [`### ${title}`, "", "| Artifact | Size |", "| --- | --- |", ...rows, ""].join("\n");
};

export const listArtifacts = (dir: string): { name: string; bytes: number }[] =>
  readdirSync(dir).map((name) => ({ name, bytes: statSync(join(dir, name)).size }));

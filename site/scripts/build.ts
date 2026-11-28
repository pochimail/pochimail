import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

/** What the app's design system provides to the site. Copied at build time, never committed under site/. */
const UI = ["packages", "ui", "src"] as const;
const FONT_FILES = [
  "newsreader-latin.woff2",
  "instrument-sans-latin.woff2",
  "OFL-Newsreader.txt",
  "OFL-InstrumentSans.txt",
] as const;
const MASCOT_FILES = [
  "pochi-default.png",
  "pochi-default@2x.png",
  "pochi-night.png",
  "pochi-night@2x.png",
  "LICENSE",
] as const;

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

/**
 * tokens.css switches to dark with a `.dark` class. The site follows the system instead, so the same dark values are
 * repeated under `prefers-color-scheme: dark`, taken from the copied file and not retyped.
 */
export const withSystemDark = (tokens: string): string => {
  const dark = /\.dark\s*\{([^}]*)\}/.exec(tokens)?.[1];
  if (dark === undefined) throw new Error("tokens.css has no .dark block");
  return `${tokens}\n@media (prefers-color-scheme: dark) {\n  :root {${dark}}\n}\n`;
};

const fill = (html: string, values: Record<string, string>): string =>
  html.replace(/\{\{(\w+)\}\}/g, (match, key: string) => values[key] ?? match);

/** Builds the static site: the pages from `site/src` with their placeholders filled, plus the app's tokens, fonts and mascot. */
export const buildSite = (root: string, outDir: string): void => {
  const siteDir = join(root, "site");
  const src = join(siteDir, "src");
  const config = JSON.parse(readFileSync(join(siteDir, "site.config.json"), "utf8")) as {
    contactEmail: string;
    lastUpdated: string;
  };
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    repository: { url: string };
  };
  const values = {
    contactEmail: config.contactEmail,
    lastUpdated: config.lastUpdated,
    repositoryUrl: manifest.repository.url.replace(/^git\+/, "").replace(/\.git$/, ""),
  };

  rmSync(outDir, { recursive: true, force: true });
  for (const file of walk(src)) {
    const target = join(outDir, file.slice(src.length + 1));
    mkdirSync(join(target, ".."), { recursive: true });
    if (file.endsWith(".html")) writeFileSync(target, fill(readFileSync(file, "utf8"), values));
    else cpSync(file, target);
  }

  const ui = join(root, ...UI);
  const assets = join(outDir, "assets");
  mkdirSync(join(assets, "fonts"), { recursive: true });
  mkdirSync(join(assets, "mascot"), { recursive: true });
  writeFileSync(
    join(assets, "tokens.css"),
    withSystemDark(readFileSync(join(ui, "styles", "tokens.css"), "utf8")),
  );
  for (const name of FONT_FILES)
    cpSync(
      join(ui, "fonts", name.endsWith(".txt") ? "" : "woff2", name),
      join(assets, "fonts", name),
    );
  for (const name of MASCOT_FILES)
    cpSync(join(ui, "assets", "mascot", name), join(assets, "mascot", name));
};

if (import.meta.main) {
  const root = join(import.meta.dirname, "..", "..");
  const outDir = join(root, "site", "dist");
  buildSite(root, outDir);
  process.stdout.write(`site built in ${outDir}\n`);
}

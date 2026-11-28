import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildSite } from "./build.ts";
import { checkSite, LIMITED_USE } from "./check.ts";

const repo = join(import.meta.dirname, "..", "..");
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A scratch copy of everything the build reads, so a test can break the sources or the output without touching the repository. */
const scratch = () => {
  const root = mkdtempSync(join(tmpdir(), "pochimail-site-"));
  roots.push(root);
  for (const path of [
    "package.json",
    "site/site.config.json",
    "site/src",
    "packages/ui/src/styles/tokens.css",
    "packages/ui/src/fonts",
    "packages/ui/src/assets/mascot",
  ]) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    cpSync(join(repo, path), join(root, path), { recursive: true });
  }
  const dist = join(root, "site", "dist");
  buildSite(root, dist);
  return { root, dist, page: (name: string) => join(dist, name) };
};

const edit = (file: string, change: (text: string) => string) =>
  writeFileSync(file, change(readFileSync(file, "utf8")));

describe("site", () => {
  // Guards: a build that is already broken (missing page, unfilled placeholder, broken link) reaching Pages.
  it("builds a site that passes its own check", () => {
    const { root, dist } = scratch();
    expect(checkSite(root, dist)).toEqual([]);
  });

  // Guards: a policy that loses the Limited Use sentence, a scope, the contact address or its date, which Google's review reads.
  it("keeps the Limited Use sentence, the scopes, the contact address and the date in the policy", () => {
    const { root, dist, page } = scratch();
    const policy = readFileSync(page("privacy/index.html"), "utf8");
    expect(policy.replace(/<[^>]+>/g, "").replace(/\s+/g, " ")).toContain(LIMITED_USE);
    for (const [label, change] of [
      ["Limited Use", (t: string) => t.replace("Limited Use requirements", "usage guidelines")],
      ["scope", (t: string) => t.replaceAll("gmail.send", "gmail.compose")],
      ["contact", (t: string) => t.replaceAll("mailto:", "contact:")],
      ["date", (t: string) => t.replace(/Last updated:/, "Updated:")],
    ] as const) {
      edit(page("privacy/index.html"), change);
      expect(checkSite(root, dist).join("\n"), label).toMatch(/privacy:/);
      writeFileSync(page("privacy/index.html"), policy);
    }
  });

  // Guards: an analytics script, a hosted font, a remote image or a stylesheet import slipping onto a page.
  it("fails on any external script, stylesheet, font or image, and allows github.com links", () => {
    const { root, dist, page } = scratch();
    const home = readFileSync(page("index.html"), "utf8");
    for (const bad of [
      '<script src="https://cdn.example/a.js"></script>',
      '<link rel="stylesheet" href="https://fonts.example/css">',
      '<img src="https://images.example/a.png" alt="">',
      '<link rel="preconnect" href="https://fonts.example">',
      '<img src="x.png" srcset="//cdn.example/x.png 2x" alt="">',
    ]) {
      edit(page("index.html"), (t) => t.replace("</head>", `${bad}</head>`));
      expect(checkSite(root, dist).join("\n"), bad).toMatch(/external resource/);
      writeFileSync(page("index.html"), home);
    }
    edit(page("style.css"), (css) => `@import url("https://fonts.example/css");\n${css}`);
    expect(checkSite(root, dist).join("\n")).toMatch(/external resource/);
    edit(page("style.css"), (css) => css.replace(/^@import.*\n/, ""));
    edit(page("index.html"), (t) =>
      t.replace("</main>", '<a href="https://tracker.example/">x</a></main>'),
    );
    expect(checkSite(root, dist).join("\n")).toMatch(/host the site does not allow/);
  });

  // Guards: a link or asset that works at a domain root but breaks under /pochimail/.
  it("fails on a root-absolute link, a link that escapes the base path and a missing target", () => {
    const { root, dist, page } = scratch();
    const policy = readFileSync(page("privacy/index.html"), "utf8");
    for (const [bad, message] of [
      ['<a href="/privacy/">x</a>', /escapes/],
      ['<a href="../../x/">x</a>', /leaves/],
      ['<a href="gone/">x</a>', /does not exist/],
      ['<img src="../assets/mascot/missing.png" alt="">', /does not exist/],
    ] as const) {
      edit(page("privacy/index.html"), (t) => t.replace("</main>", `${bad}</main>`));
      expect(checkSite(root, dist).join("\n"), bad).toMatch(message);
      writeFileSync(page("privacy/index.html"), policy);
    }
  });

  // Guards: the theme being retyped or copied into site/ instead of coming from packages/ui.
  it("takes tokens, fonts and mascot from packages/ui and refuses copies in the sources", () => {
    const { root, dist } = scratch();
    const tokens = readFileSync(join(repo, "packages/ui/src/styles/tokens.css"), "utf8");
    const built = readFileSync(join(dist, "assets/tokens.css"), "utf8");
    expect(built.startsWith(tokens)).toBe(true);
    expect(built).toMatch(
      /@media \(prefers-color-scheme: dark\) \{\s*:root \{[^}]*--background: #121315/,
    );
    expect(readFileSync(join(dist, "assets/fonts/newsreader-latin.woff2"))).toEqual(
      readFileSync(join(repo, "packages/ui/src/fonts/woff2/newsreader-latin.woff2")),
    );
    writeFileSync(join(root, "site/src/copy.woff2"), "x");
    expect(checkSite(root, dist).join("\n")).toMatch(/belongs in packages\/ui/);
    rmSync(join(root, "site/src/copy.woff2"));
    edit(join(root, "site/src/style.css"), (css) => `${css}\nbody { color: #123456; }`);
    expect(checkSite(root, dist).join("\n")).toMatch(/color literal/);
  });
});

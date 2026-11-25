import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { adoptRuntimeStyles } from "./csp-safe-styles.ts";

/** The installed package's directory, found the way the bundler finds it: from the package that depends on it. */
const packageDir = (from: string, name: string): string => {
  let dir = dirname(createRequire(from).resolve(name));
  while (
    !existsSync(join(dir, "package.json")) ||
    JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name !== name
  )
    dir = dirname(dir);
  return dir;
};

const ui = fileURLToPath(import.meta.resolve("@pochimail/ui/components/sonner"));
const sonner = join(packageDir(ui, "sonner"), "dist/index.mjs");
// react-style-singleton is not ours: it is reached through radix-ui, its dialog and react-remove-scroll.
const through = (from: string, ...names: string[]): string =>
  names.reduce((dir, name) => packageDir(join(dir, "package.json"), name), dirname(from));
const singleton = join(
  through(ui, "radix-ui", "@radix-ui/react-dialog", "react-remove-scroll", "react-style-singleton"),
  "dist/es2015/singleton.js",
);

const INLINE_STYLE = /createElement\(\s*['"]style['"]\s*\)/;

describe("adoptRuntimeStyles on the installed libraries", () => {
  it("makes Sonner adopt a constructable stylesheet instead of adding a <style> element", () => {
    // Guards: a Sonner upgrade that moves its CSS injection, which would ship unstyled toasts under `style-src 'self'`.
    const original = readFileSync(sonner, "utf8");
    expect(original).toMatch(INLINE_STYLE);
    const rewritten = adoptRuntimeStyles(sonner, original);
    expect(rewritten).toContain("new CSSStyleSheet()");
    expect(rewritten).toContain("document.adoptedStyleSheets");
    expect(rewritten).not.toMatch(INLINE_STYLE);
  });

  it("makes react-style-singleton adopt a constructable stylesheet and keep its export", () => {
    // Guards: a react-style-singleton upgrade that changes the scroll lock's behaviour while keeping the text we match.
    const original = readFileSync(singleton, "utf8");
    expect(original).toMatch(INLINE_STYLE);
    const rewritten = adoptRuntimeStyles(singleton, original);
    expect(rewritten).toContain("export var stylesheetSingleton");
    expect(rewritten).toContain("new CSSStyleSheet()");
    expect(rewritten).not.toMatch(INLINE_STYLE);
  });

  it("fails the build when the code to rewrite has moved", () => {
    // Guards: a library change that silently leaves the inline <style> in place.
    expect(() =>
      adoptRuntimeStyles(sonner, readFileSync(sonner, "utf8").replace("__insertCSS", "__addCSS")),
    ).toThrow(/no __insertCSS/);
    expect(() =>
      adoptRuntimeStyles(
        singleton,
        readFileSync(singleton, "utf8").replace("stylesheetSingleton", "styleSheetSingleton"),
      ),
    ).toThrow(/moved/);
  });
});

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export type CopyOffense = { readonly file: string; readonly literal: string };

// User copy in a screen is either JSX text, a string child, or a copy-bearing prop.
// Class names, data-slot values and t("key") calls contain no three-letter word between tags.
// A `>` next to `=` is an arrow or comparison operator, never the end of a JSX tag.
const jsxText = /(?<!=)>(?!=)([^<>{}]*\p{L}{3,}[^<>{}]*)</gu;
const stringChild = /\{\s*(['"])([^'"{}]*\p{L}{3,}[^'"{}]*)\1\s*\}/gu;
const copyProp =
  /\b(?:title|label|alt|description|placeholder|headline|sentence|reason)\s*=\s*(['"])([^'"{}]*\p{L}{3,}[^'"{}]*)\1/gu;
const copyVariable =
  /\b(?:const|let)\s+(?:title|label|description|headline|sentence|reason|text)\w*\s*=\s*(['"])([^'"{}]*\p{L}{3,}[^'"{}]*)\1/gu;

/** Every hard-coded user-facing literal in one screen component's source. */
export const findHardcodedCopy = (source: string): readonly string[] => {
  const found: string[] = [];
  for (const pattern of [jsxText, stringChild, copyProp, copyVariable]) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const literal = (match[2] ?? match[1] ?? "").trim();
      if (literal.length > 0) found.push(literal);
    }
  }
  return found;
};

const screenFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return screenFiles(path);
    if (!entry.name.endsWith(".tsx")) return [];
    if (entry.name.endsWith(".test.tsx") || entry.name.endsWith(".stories.tsx")) return [];
    return [path];
  });

/** Coverage for the whole renderer: a future screen with literal copy fails its test. */
export const screenCopyOffenses = (screenDir: string): readonly CopyOffense[] =>
  screenFiles(screenDir).flatMap((file) =>
    findHardcodedCopy(readFileSync(file, "utf8")).map((literal) => ({
      file: relative(screenDir, file),
      literal,
    })),
  );

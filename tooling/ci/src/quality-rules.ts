/**
 * Mechanical quality rules that Biome, knip and dependency-cruiser do not cover.
 * Each rule exists because the codebase already broke it once (ADR 0015).
 * Pure functions over file contents: no I/O here, so every rule is unit-tested.
 */

type RuleId =
  | "file-too-long"
  | "arbitrary-size"
  | "raw-breakpoint"
  | "raw-color"
  | "deep-relative-import"
  | "todo-without-ticket";

export interface Finding {
  readonly rule: RuleId;
  readonly file: string;
  readonly count: number;
}

/** A source file that ships (tests, stories, benches and fixtures are excluded by the caller). */
export interface SourceFile {
  readonly path: string;
  readonly text: string;
}

/** Above this, a file almost always holds more than one responsibility. Split it. */
export const MAX_LINES = 300;

const isMarkup = (path: string) => path.endsWith(".tsx");
const isStyles = (path: string) => /\/styles\//.test(path) || path.endsWith(".css");

const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;

const RULES: Record<RuleId, (file: SourceFile) => number> = {
  // One responsibility per file; long files hide several.
  "file-too-long": ({ text }) => {
    const lines = text.split("\n").length;
    return lines > MAX_LINES ? lines - MAX_LINES : 0;
  },
  // Sizes come from the type/spacing/radius scale in theme.css, never `text-[15px]` or `font-[450]`.
  "arbitrary-size": ({ path, text }) =>
    isMarkup(path)
      ? count(
          text,
          /(?<![@\w-])(?:text|font|leading|tracking|rounded|gap|size|[pm][xytrbl]?|[hw]|min-[hw]|max-[hw])-\[[\d.]+(?:px|rem|em)?\]/g,
        )
      : 0,
  // Breakpoints are named in theme.css (`@max-tabs:`), never `@max-[560px]:` repeated by hand.
  "raw-breakpoint": ({ path, text }) =>
    isMarkup(path) ? count(text, /@(?:min|max)-\[\d+px\]/g) : 0,
  // Colors are tokens. A hex or rgb() literal outside the styles folder bypasses light/dark.
  "raw-color": ({ path, text }) =>
    isStyles(path)
      ? 0
      : count(text, /["'`]#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|rgba?\(\s*\d/g),
  // `../../../` couples a file to the folder layout. Use the package's subpath imports (`#shared/*`).
  "deep-relative-import": ({ text }) => count(text, /from\s+["'](?:\.\.\/){3,}/g),
  // A to-do marker without an issue is a promise nobody owns: add the GitHub issue number in
  // parentheses right after the marker, e.g. "(#123)", or delete it.
  "todo-without-ticket": ({ text }) => count(text, /\b(?:T[O]DO|F[I]XME|H[A]CK)\b(?!\(#\d+\))/g),
};

export function findingsFor(files: readonly SourceFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    for (const rule of Object.keys(RULES) as RuleId[]) {
      const n = RULES[rule](file);
      if (n > 0) findings.push({ rule, file: file.path, count: n });
    }
  }
  return findings;
}

/** `rule|file` → allowed count. Existing debt is frozen here and may only shrink. */
export type Baseline = Readonly<Record<string, number>>;

export const keyOf = (f: Pick<Finding, "rule" | "file">) => `${f.rule}|${f.file}`;

export interface Verdict {
  /** Findings above their baseline: these fail the build. */
  readonly regressions: readonly (Finding & { readonly allowed: number })[];
  /** Baseline entries that are now lower or gone: tighten the baseline in the same PR. */
  readonly improvements: readonly string[];
}

export function judge(findings: readonly Finding[], baseline: Baseline): Verdict {
  const now = new Map(findings.map((f) => [keyOf(f), f]));
  const regressions = findings
    .map((f) => ({ ...f, allowed: baseline[keyOf(f)] ?? 0 }))
    .filter((f) => f.count > f.allowed);
  const improvements = Object.entries(baseline)
    .filter(([key, allowed]) => (now.get(key)?.count ?? 0) < allowed)
    .map(([key]) => key);
  return { regressions, improvements };
}

/** Every workspace explains itself. A package that cannot fill these in has no reason to exist. */
export const README_SECTIONS = [
  "## Why this package exists",
  "## Owns",
  "## May import",
  "## Must not contain",
] as const;

export const missingReadmeSections = (readme: string | null): string[] =>
  readme === null ? [...README_SECTIONS] : README_SECTIONS.filter((h) => !readme.includes(h));

/**
 * The only Markdown files allowed, with a word budget each. A fact lives in one place; reasons live
 * in ADRs. A new document needs a line here, which needs a reason in the PR.
 */
const DOC_BUDGETS: readonly (readonly [pattern: RegExp, maxWords: number])[] = [
  [/^README\.md$/, 300],
  [/^AGENTS\.md$/, 700],
  [/^CONTRIBUTING\.md$/, 350],
  [/^ARCHITECTURE\.md$/, 600],
  [/^SECURITY\.md$/, 300],
  [/^TRADEMARKS\.md$/, 400],
  [/^docs\/product\.md$/, 800],
  [/^docs\/design\.md$/, 1200],
  [/^docs\/security\.md$/, 1200],
  [/^docs\/release\.md$/, 500],
  [/^docs\/adr\/README\.md$/, 200],
  [/^docs\/adr\/\d{4}-[a-z0-9-]+\.md$/, 400],
  [/^docs\/design\/README\.md$/, 200],
  [/^docs\/design\/[^/]+\/README\.md$/, 120],
  [/^(apps|packages|tooling)\/[^/]+\/README\.md$/, 150],
  [/^\.github\/[^/]+\.md$/, 250],
  [/^\.github\/ISSUE_TEMPLATE\/[^/]+\.md$/, 200],
  [/^(apps|packages)\/(?:[^/]+\/)*AGENTS\.md$/, 200],
];

export interface DocFile {
  readonly path: string;
  readonly words: number;
}

export const countWords = (markdown: string): number =>
  markdown
    .replace(/```[\s\S]*?```/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;

/** Docs are not baselined: an unlisted or oversized document fails the build. */
export function docProblems(docs: readonly DocFile[]): string[] {
  return docs.flatMap(({ path, words }) => {
    const budget = DOC_BUDGETS.find(([pattern]) => pattern.test(path));
    if (!budget)
      return [
        `${path} is not an allowed document (add it to DOC_BUDGETS with a reason, or delete it)`,
      ];
    return words > budget[1] ? [`${path} has ${words} words (budget ${budget[1]})`] : [];
  });
}

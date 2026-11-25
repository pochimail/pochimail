// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Source of truth is read from disk (tokens.css = what ships, tokens.json = the design source); no values are copied here.
const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);
const json = JSON.parse(readFileSync(new URL("./tokens.json", import.meta.url), "utf8")) as {
  color: Record<
    string,
    Record<string, { $value?: string; light?: { $value: string }; dark?: { $value: string } }>
  >;
};

type Theme = "light" | "dark";
type Tokens = Record<string, string>;

function cssTokens(selector: ":root" | ".dark"): Tokens {
  const out: Tokens = {};
  for (const block of css.matchAll(/(^|\n)([^\s{][^{]*)\{([^}]*)\}/g)) {
    if (block[2]?.trim() !== selector) continue;
    for (const decl of (block[3] ?? "").matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g))
      out[decl[1] as string] = decl[2] as string;
  }
  return out;
}

const themes: Record<Theme, Tokens> = { light: cssTokens(":root"), dark: cssTokens(".dark") };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// [foreground token, background token] by CSS variable name, as used by components (brief §6, docs/design.md › Color).
const surfaces = ["background", "card", "sidebar", "muted", "popover"];
const textPairs: [string, string][] = [
  ...surfaces.flatMap((s): [string, string][] => [
    ["foreground", s],
    ["muted-foreground", s],
    ["foreground-tertiary", s],
  ]),
  ["primary-foreground", "primary"],
  // Composites (M4-04): card text, the always-dark undo toast, the selected pill label.
  ["card-foreground", "card"],
  ["popover-foreground", "popover"],
  ["destructive", "background"],
  ["destructive", "card"],
  ["background", "destructive"], // destructive button label
];
const categories = Object.keys(json.color.category ?? {}).map((n) => `category-${n}`);
const graphicPairs: [string, string][] = [
  ["ring", "background"],
  ["ring", "card"],
  ["primary", "background"],
  ["primary", "card"],
  // Unchecked checkbox/radio outline (components use border-foreground-tertiary, see the source check below).
  ["foreground-tertiary", "background"],
  ["foreground-tertiary", "card"],
  // Composites (M4-03): hatched storage segment and ledger bar fill on the muted track, progress fill on its track.
  ["foreground-tertiary", "muted"],
  ["primary", "muted"],
  ...categories.map((c): [string, string] => [c, "muted"]),
  ...categories.flatMap((c): [string, string][] => [
    [c, "background"],
    [c, "card"],
  ]),
];

// Pochi's rim light exists in dark only (the charcoal night pose is invisible there; see docs/design.md › Pochi).
const rimPairs = surfaces.map((s): [string, string] => ["mascot-rim", s]);

function failures(tokens: Tokens, pairs: [string, string][], min: number): string[] {
  return pairs.flatMap(([fg, bg]) => {
    const [a, b] = [tokens[fg], tokens[bg]];
    if (!a || !b) return [`${fg} on ${bg}: token missing`];
    const ratio = contrast(a, b);
    return ratio >= min ? [] : [`${fg} on ${bg}: ${ratio.toFixed(2)} < ${min}`];
  });
}

describe.each(["light", "dark"] as const)("%s theme contrast", (theme) => {
  // Guards: a token edited to a value that breaks AA text contrast (4.5:1, tertiary text included).
  it("text pairs are >= 4.5:1", () => {
    expect(failures(themes[theme], textPairs, 4.5)).toEqual([]);
  });

  // Guards: focus ring, primary and category graphics dropping under 3:1.
  it("graphic pairs are >= 3:1", () => {
    expect(failures(themes[theme], graphicPairs, 3)).toEqual([]);
  });
});

// Guards: the charcoal night pose losing its outline on a dark surface.
it("dark theme: Pochi's rim light is >= 3:1 on every surface", () => {
  expect(failures(themes.dark, rimPairs, 3)).toEqual([]);
});

// Guards: tokens.css drifting from tokens.json (the contrast result would then describe the wrong palette).
it("tokens.css matches tokens.json in both themes", () => {
  const map: Record<string, string> = {
    background: "background",
    surface: "card",
    sidebar: "sidebar",
    muted: "muted",
    border: "border",
    text: "foreground",
    textSecondary: "muted-foreground",
    textTertiary: "foreground-tertiary",
    primary: "primary",
    primaryForeground: "primary-foreground",
    focus: "ring",
    danger: "destructive",
    frame: "frame",
  };
  const mismatches: string[] = [];
  for (const theme of ["light", "dark"] as const) {
    for (const [name, cssName] of Object.entries(map)) {
      const expected = json.color[theme]?.[name]?.$value;
      if (expected?.toLowerCase() !== themes[theme][cssName]?.toLowerCase())
        mismatches.push(`${theme}.${name} -> --${cssName}`);
    }
    for (const [name, v] of Object.entries(json.color.category ?? {})) {
      if (v[theme]?.$value.toLowerCase() !== themes[theme][`category-${name}`]?.toLowerCase())
        mismatches.push(`${theme}.category.${name}`);
    }
  }
  const rim = json.color.dark?.mascotRim?.$value?.toLowerCase();
  if (rim !== themes.dark["mascot-rim"]?.toLowerCase()) mismatches.push("dark.mascotRim");
  if (themes.light["mascot-rim"] !== undefined) mismatches.push("light.mascotRim must not exist");
  expect(mismatches).toEqual([]);
});

// Guards: a vacuous gate. A real token pushed to a failing value must be reported, in either theme.
it("reports a token changed to a failing value", () => {
  const broken = { ...themes.light, "foreground-tertiary": "#B0B4BA", ring: "#E0E0E0" };
  expect(failures(broken, textPairs, 4.5).join()).toContain("foreground-tertiary on background");
  expect(failures(broken, graphicPairs, 3).join()).toContain("ring on card");
  expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
});

// Guards: the control outlines reverting to the hairline --input/--border token (about 1.3:1, fails the 3:1 graphic rule).
it.each(["checkbox", "radio-group", "pill-radio-group"])(
  "%s outline uses the gated token",
  (name) => {
    const src = readFileSync(new URL(`../components/${name}.tsx`, import.meta.url), "utf8");
    expect(src).toContain("border-foreground-tertiary");
    expect(src).not.toMatch(/border-(input|border)\b/);
  },
);

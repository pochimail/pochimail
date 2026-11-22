// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { MOTION, MOTION_EASE } from "@pochimail/ui/lib/motion";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const board = read("../../../../docs/design/screens/source/Motion.dc.html");
const css = read("../styles/globals.css");

describe("motion catalog timings", () => {
  // Guards: a constant drifting from the design board (the P5 source of truth) without anyone noticing.
  it("every catalog timing and the easing appear in Motion.dc.html", () => {
    const fromBoard = (re: RegExp) => Number(re.exec(board)?.[1]);
    expect(MOTION_EASE.replaceAll(" ", "")).toBe("cubic-bezier(0.22,1,0.36,1)");
    expect(board).toContain(MOTION_EASE.replaceAll(" ", ""));
    expect(fromBoard(/width: \{\{pct\}\}%; transition: width (\d+)ms/)).toBe(MOTION.progressMs);
    expect(fromBoard(/\{\{bw0\}\}%[^"]*transition: width (\d+)ms/)).toBe(MOTION.storageBarMs);
    expect(fromBoard(/transition: width \d+ms [^ ]+ (\d+)ms"/)).toBe(
      MOTION.storageBarHatchedDelayMs,
    );
    expect(fromBoard(/transition: max-height (\d+)ms/)).toBe(MOTION.rowFoldMs);
    expect(fromBoard(/opacity (\d+)ms ease-out; \{\{rowStyle/)).toBe(MOTION.rowFadeMs);
    expect(fromBoard(/transition: transform (\d+)ms/)).toBe(MOTION.switchMs);
    expect(fromBoard(/const k = Math\.min\(1, \(Date\.now\(\) - t0\) \/ (\d+)\)/)).toBe(
      MOTION.countUpMs,
    );
    expect(fromBoard(/(\d+)ms<\/strong> summary sheet enter/)).toBe(MOTION.sheetMs);
    expect(fromBoard(/(\d+)ms<\/strong> panels, steps, toasts/)).toBe(MOTION.panelMs);
    expect(board).toContain(`${MOTION.pressMs}ms`);
    expect(board).toContain(`${MOTION.mascotBreathingMs / 1000}s`);
    expect(board).toContain(`${MOTION.mascotBlinkMs / 1000}s`);
    expect(board).toContain(`${MOTION.mascotFoundMs}ms`);
  });

  // Guards: CSS keyframe durations drifting from the constants the tests above pin to the board.
  it("CSS animations use the catalog durations and one easing", () => {
    const anim = (name: string) =>
      new RegExp(
        `--animate-${name}: [\\w-]+ (\\d+)ms ${MOTION_EASE.replace(/[()]/g, "\\$&")}`,
      ).exec(css)?.[1];
    expect(Number(anim("sheet-in"))).toBe(MOTION.sheetMs);
    expect(Number(anim("sheet-scrim-in"))).toBe(MOTION.sheetMs);
    expect(Number(anim("screen-in"))).toBe(MOTION.screenMs);
    expect(Number(anim("finding-in"))).toBe(MOTION.panelMs);
    expect(Number(anim("pochi-found"))).toBe(MOTION.mascotFoundMs);
    // The flat-PNG eyelids use the board's blink cadence without adding a second looping token.
    expect(css).toContain(`animation: pochi-lid ${MOTION.mascotBlinkMs / 1000}s infinite`);
    expect(css).toMatch(new RegExp(`\\[data-sonner-toast\\][^}]*${MOTION.toastMs}ms`));
  });

  // Guards: a decorative loop sneaking in; only Pochi's breathing and blink may repeat.
  it("only the mascot animations loop", () => {
    const loops = [...css.matchAll(/--animate-([\w-]+):[^;]*\binfinite\b/g)].map((m) => m[1]);
    expect(loops.sort()).toEqual(["pochi-blink", "pochi-breathe"]);
  });

  // Guards: component classes hard-coding a timing or easing instead of the catalog tokens/inline MOTION values.
  it("components carry no stray duration or easing literals", () => {
    const dir = new URL("../components/", import.meta.url);
    const files = readdirSync(dir).filter(
      (f) => f.endsWith(".tsx") && !/\.(test|stories)\./.test(f),
    );
    files.push(
      "../../../../apps/desktop/src/renderer/src/features/onboarding/onboarding-layout.tsx",
    );
    const bad = files.flatMap((f) => {
      const src = readFileSync(new URL(f, dir), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      return [
        ...src.matchAll(/duration-\d|duration-\[|ease-\[|cubic-bezier|[^-(]ease-out|\b\d+ms\b/g),
      ].map((m) => `${f}: ${m[0]}`);
    });
    expect(bad).toEqual([]);
  });

  // Guards: design tokens used by classes (duration-(--duration-press)) drifting from the catalog.
  it("tokens.css press and panel durations match the catalog", () => {
    const tokens = read("../styles/tokens.css");
    expect(tokens).toContain(`--duration-press: ${MOTION.pressMs}ms`);
    expect(tokens).toContain(`--duration-panel: ${MOTION.panelMs}ms`);
    expect(tokens).toContain(`--ease-out: ${MOTION_EASE}`);
  });

  const media = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}\n/.exec(css)?.[1] ?? "";
  const attr = css.slice(css.indexOf(':root[data-animations="off"] {'));
  const norm = (x: string) =>
    x.replace(/:root\[data-animations="off"\]\s*/g, "").replace(/\s+/g, " ");

  // Guards: reduced motion or Animations off still moving things: slide distances must be 0, scale/translate vars neutral, only opacity/colors transition.
  it.each([
    ["prefers-reduced-motion", media],
    ["Animations off", attr],
  ])("%s removes transforms and leaves an opacity cross-fade", (_n, block) => {
    for (const v of [
      "--motion-shift-sm: 0px",
      "--motion-shift-md: 0px",
      "--motion-sheet-from: 0px",
    ])
      expect(block).toContain(v);
    for (const v of [
      "--tw-enter-scale: 1",
      "--tw-exit-scale: 1",
      "--tw-enter-translate-y: 0",
      "--tw-exit-translate-x: 0",
    ])
      expect(block).toContain(v);
    expect(block).toContain("[data-sonner-toast]");
    expect(block).toMatch(/transition-property: opacity,/);
    expect(block).not.toMatch(/transition-property:[^;]*transform/);
    expect(block).toContain("animation-duration: 120ms");
  });

  // Guards: the two reduced-motion blocks (OS preference, Animations setting) diverging.
  it("both reduced-motion blocks declare the same neutralising rules", () => {
    const decls = (x: string) => [...norm(x).matchAll(/[\w-]+: [^;]+;/g)].map((m) => m[0]).sort();
    expect([...new Set(decls(media))]).toEqual([...new Set(decls(attr))]);
  });

  // Guards: a new keyframe moving with a literal distance that reduced motion cannot neutralise (Pochi's are gated in JS).
  it("every non-mascot keyframe transform reads a --motion-shift variable", () => {
    const frames = [...css.matchAll(/@keyframes ([\w-]+) \{([\s\S]*?\n {2}\}|[^\n]*\})/g)];
    const moving = frames.filter(
      ([, name, body]) => !name?.startsWith("pochi") && /translate/.test(body ?? ""),
    );
    expect(moving.length).toBeGreaterThan(0);
    for (const [, name, body] of moving)
      for (const m of (body ?? "").matchAll(/translate[XY]\(([^)]*\)?)\)/g))
        expect(m[1], `${name} translate`).toContain("var(--motion-");
  });
});

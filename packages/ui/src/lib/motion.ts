/**
 * Motion catalog timings (docs/design/screens/source/Motion.dc.html is the source of truth; docs/design.md › Motion catalog).
 * motion.test.ts fails when a board-sourced value here stops matching that file. One easing everywhere; only Pochi's
 * breathing and blink may loop. The one-shot idle flourishes are JS-triggered and live only here, not in the board.
 */
export const MOTION = {
  /** Press, hover, checkbox ring, small feedback. */
  pressMs: 150,
  /** Panels, menus, steps, finding text, toasts. */
  panelMs: 220,
  /** Screen-to-screen slide. */
  screenMs: 220,
  /** Summary sheet enter: scrim fade + slide. */
  sheetMs: 250,
  /** Progress line glide. */
  progressMs: 600,
  /** Numbers roll up once. */
  countUpMs: 600,
  /** Storage bar settle: keep segment, then cleanable segment after a delay. */
  storageBarMs: 700,
  storageBarHatchedDelayMs: 140,
  /** Cleanup row fold (height) and its fade. */
  rowFoldMs: 260,
  rowFadeMs: 200,
  /** Undo toast rise. */
  toastMs: 220,
  /** Switch thumb glide. */
  switchMs: 180,
  /** How long the undo toast stays. */
  undoMs: 5000,
  /** Pochi. */
  mascotBreathingMs: 4200,
  mascotBlinkMs: 5300,
  mascotFoundMs: 620,
  /** One-shot idle flourishes (glance/nod/tilt). */
  mascotIdleMs: 800,
  /** Infrequent, randomized gap between idle flourishes. */
  mascotIdleMinGapMs: 9000,
  mascotIdleMaxGapMs: 18000,
} as const;

/** Opacity-only fades (row fade, reduced-motion cross-fade). */
export const MOTION_FADE_EASE = "ease-out";
export const MOTION_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
/** Same curve as a function (1 − (1 − k)³), for JS-driven numbers. */
export const easeOutCubic = (k: number) => 1 - (1 - k) ** 3;

/** Inline `transition` value in catalog timing, e.g. transition({ property: "width", ms: MOTION.progressMs }). Reduced motion strips non-opacity properties (globals.css). */
export function transition(
  ...parts: { property: string; ms: number; delayMs?: number; ease?: string }[]
): string {
  return parts
    .map((p) => `${p.property} ${p.ms}ms ${p.ease ?? MOTION_EASE} ${p.delayMs ?? 0}ms`)
    .join(", ");
}

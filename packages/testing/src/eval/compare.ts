import { CATEGORIES, SIGNAL_KINDS } from "@pochimail/classification/model/category";
import type { EvalReport } from "./report.ts";

/** A class may lose at most this much precision or recall before the gate fails. */
export const DEFAULT_TOLERANCE = 0.02;

export interface Regression {
  readonly group: "category" | "signal" | "suspicious";
  readonly name: string;
  readonly metric: "precision" | "recall";
  readonly baseline: number;
  readonly current: number;
}

export interface Comparison {
  readonly ok: boolean;
  readonly regressions: readonly Regression[];
  /** Set when the two reports do not measure the same fixture, so the numbers are not comparable. */
  readonly mismatch?: string;
}

/**
 * Compares a run to the committed baseline. Only drops beyond `tolerance` fail; improvements
 * pass (refresh the baseline to lock them in).
 */
export function compareToBaseline(
  current: EvalReport,
  baseline: EvalReport,
  tolerance = DEFAULT_TOLERANCE,
): Comparison {
  const a = baseline.fixture;
  const b = current.fixture;
  if (a.seed !== b.seed || a.scale !== b.scale) {
    return {
      ok: false,
      regressions: [],
      mismatch: `baseline is seed ${a.seed} scale ${a.scale}, run is seed ${b.seed} scale ${b.scale}`,
    };
  }
  const regressions: Regression[] = [];
  const check = (
    group: Regression["group"],
    names: readonly string[],
    from: Record<string, EvalReport["categories"][keyof EvalReport["categories"]]>,
    to: Record<string, EvalReport["categories"][keyof EvalReport["categories"]]>,
  ) => {
    for (const name of names) {
      for (const metric of ["precision", "recall"] as const) {
        const was = from[name]?.[metric] ?? 0;
        const now = to[name]?.[metric] ?? 0;
        // Epsilon: 4-decimal ratios must not trip on floating-point noise at the boundary.
        if (was - now > tolerance + 1e-9)
          regressions.push({ group, name, metric, baseline: was, current: now });
      }
    }
  };
  check("category", CATEGORIES, baseline.categories, current.categories);
  check("signal", SIGNAL_KINDS, baseline.signals, current.signals);
  check(
    "suspicious",
    ["suspicious"],
    { suspicious: baseline.suspicious },
    { suspicious: current.suspicious },
  );
  return { ok: regressions.length === 0, regressions };
}

export function describeRegressions(comparison: Comparison): string[] {
  if (comparison.mismatch) return [`Fixture mismatch: ${comparison.mismatch}`];
  return comparison.regressions.map(
    (r) => `${r.group} ${r.name}: ${r.metric} ${r.baseline} -> ${r.current}`,
  );
}

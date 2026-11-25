import { readFileSync, writeFileSync } from "node:fs";
import type { EmailType } from "@pochimail/classification/model/email-type";
import { createGroundTruthClassifier } from "@pochimail/classification/testing/ground-truth-classifier";
import { describe, expect, it } from "vitest";
import { generateMailbox, type MailboxScale } from "../fixture-mailbox/generator.ts";
import { compareToBaseline, DEFAULT_TOLERANCE, describeRegressions } from "./compare.ts";
import { degradeClassifier } from "./degraded-classifier.ts";
import { runEval } from "./harness.ts";
import { evalReportSchema } from "./report.ts";

// The CI eval gate (`pnpm eval`). Configured through the environment:
//   EVAL_SCALE            small (default) or full
//   EVAL_BASELINE         baseline file to compare with (required)
//   EVAL_REPORT           where to write the JSON report
//   EVAL_UPDATE_BASELINE  1 rewrites the baseline instead of comparing
//   EVAL_DEGRADE          1 runs a deliberately worse classifier (the gate must then fail)
//   EVAL_TOLERANCE        allowed drop of precision or recall per class (default 0.02)
const SEED = 20261117;
const env = (name: string) => process.env[name] || undefined;
const scale = env("EVAL_SCALE") ?? "small";
const baselinePath = env("EVAL_BASELINE");

describe(`eval gate (${scale})`, () => {
  it("matches the committed baseline within tolerance", async () => {
    if (scale !== "small" && scale !== "full") throw new Error("EVAL_SCALE is small or full");
    if (!baselinePath) throw new Error("EVAL_BASELINE is required");
    const mailbox = generateMailbox({
      seed: SEED,
      scale: scale as MailboxScale,
      hardCases: true,
    });
    const labels = new Map<string, EmailType>(
      mailbox.labels.messages.map((l) => [l.messageId, l.category]),
    );
    const truth = createGroundTruthClassifier(labels);
    const report = await runEval({
      classifier: env("EVAL_DEGRADE") ? degradeClassifier(truth) : truth,
      mailbox,
    });
    const json = `${JSON.stringify(report, null, 2)}\n`;
    const reportPath = env("EVAL_REPORT");
    if (reportPath) writeFileSync(reportPath, json);
    for (const [group, rows] of [
      ["category", report.categories],
      ["signal", report.signals],
      ["suspicious", { suspicious: report.suspicious }],
    ] as const)
      for (const [name, m] of Object.entries(rows))
        console.log(
          `${group} ${name}: precision ${m.precision} recall ${m.recall} support ${m.support}`,
        );

    if (env("EVAL_UPDATE_BASELINE")) {
      writeFileSync(baselinePath, json);
      return;
    }
    const baseline = evalReportSchema.parse(JSON.parse(readFileSync(baselinePath, "utf8")));
    const comparison = compareToBaseline(
      report,
      baseline,
      Number(env("EVAL_TOLERANCE") ?? DEFAULT_TOLERANCE),
    );
    expect(describeRegressions(comparison), "eval regression against baseline").toEqual([]);
  });
});

import { readFileSync } from "node:fs";
import type { EmailType } from "@pochimail/classification/model/email-type";
import type { Classifier } from "@pochimail/classification/ports/classifier";
import { createGroundTruthClassifier } from "@pochimail/classification/testing/ground-truth-classifier";
import { ok } from "@pochimail/kernel/result";
import { describe, expect, it } from "vitest";
import { generateMailbox } from "../fixture-mailbox/generator.ts";
import { readMailbox } from "../fixture-mailbox/mailbox-reader.ts";
import { compareToBaseline } from "./compare.ts";
import { degradeClassifier } from "./degraded-classifier.ts";
import { runEval } from "./harness.ts";
import { scoreMultiLabel, scoreSingleLabel } from "./metrics.ts";
import { type EvalReport, evalReportSchema } from "./report.ts";

const mailbox = generateMailbox({ seed: 20261117, scale: "small" });
const labels = new Map<string, EmailType>(
  mailbox.labels.messages.map((l) => [l.messageId, l.category]),
);
const truth = () => createGroundTruthClassifier(labels);
const baseline = evalReportSchema.parse(
  JSON.parse(readFileSync(new URL("../../eval/baseline.small.json", import.meta.url), "utf8")),
);

describe("metrics", () => {
  it("hand-computed tiny fixture: precision, recall, support and accuracy are exact (guards a swapped fp/fn)", () => {
    // personal: tp 2 (a, b), fn 1 (c predicted transactional), transactional: tp 1 (d), fp 1 (c), fn 1 (e unanswered).
    const { perClass, accuracy } = scoreSingleLabel(
      ["personal", "transactional"],
      [
        { expected: "personal", predicted: "personal" },
        { expected: "personal", predicted: "personal" },
        { expected: "personal", predicted: "transactional" },
        { expected: "transactional", predicted: "transactional" },
        { expected: "transactional", predicted: undefined },
      ],
    );
    expect(perClass.personal).toMatchObject({
      support: 3,
      truePositives: 2,
      falsePositives: 0,
      falseNegatives: 1,
      precision: 1,
      recall: 0.6667,
    });
    expect(perClass.transactional).toMatchObject({
      support: 2,
      truePositives: 1,
      falsePositives: 1,
      falseNegatives: 1,
      precision: 0.5,
      recall: 0.5,
      f1: 0.5,
    });
    expect(accuracy).toBe(0.6);
  });

  it("multi-label signals are scored per kind, so one wrong kind never hides another (guards micro-averaging)", () => {
    const perKind = scoreMultiLabel(
      ["needs-reply", "has-document"],
      [
        { expected: ["needs-reply", "has-document"], predicted: ["needs-reply"] },
        { expected: [], predicted: ["needs-reply"] },
      ],
    );
    expect(perKind["needs-reply"]).toMatchObject({
      truePositives: 1,
      falsePositives: 1,
      precision: 0.5,
      recall: 1,
    });
    expect(perKind["has-document"]).toMatchObject({
      support: 1,
      falseNegatives: 1,
      precision: 1,
      recall: 0,
    });
  });
});

describe("compareToBaseline", () => {
  const worse = (drop: number): EvalReport => ({
    ...baseline,
    categories: {
      ...baseline.categories,
      personal: { ...baseline.categories.personal, recall: 1 - drop },
    },
  });

  it("a drop inside the tolerance passes and one beyond it fails (guards a gate that is too strict or too loose)", () => {
    expect(compareToBaseline(worse(0.01), baseline).ok).toBe(true);
    const failed = compareToBaseline(worse(0.05), baseline);
    expect(failed.ok).toBe(false);
    expect(failed.regressions).toEqual([
      { group: "category", name: "personal", metric: "recall", baseline: 1, current: 0.95 },
    ]);
  });

  it("a report of another fixture never passes (guards comparing numbers that are not comparable)", () => {
    const other = { ...baseline, fixture: { ...baseline.fixture, seed: 1 } };
    expect(compareToBaseline(other, baseline).ok).toBe(false);
  });
});

describe("runEval", () => {
  it("the committed baseline passes and a deliberately degraded classifier fails the comparison", async () => {
    const good = await runEval({ classifier: truth(), mailbox });
    expect(compareToBaseline(good, baseline).ok).toBe(true);

    const bad = await runEval({ classifier: degradeClassifier(truth()), mailbox });
    const comparison = compareToBaseline(bad, baseline);
    expect(comparison.ok).toBe(false);
    expect(comparison.regressions.some((r) => r.group === "category")).toBe(true);
  });

  it("takes any Classifier and counts silence as a miss (guards a harness tied to the stub)", async () => {
    const silent: Classifier = { classify: async () => ok([]) };
    const report = await runEval({ classifier: silent, mailbox });
    expect(report.unclassified).toBe(mailbox.labels.messages.length);
    expect(report.categoryAccuracy).toBe(0);
    expect(report.categories.personal.recall).toBe(0);
  });

  it("the report validates against its schema and holds no mail content (guards leaking subjects or addresses, D11)", async () => {
    const report = await runEval({ classifier: truth(), mailbox });
    expect(evalReportSchema.safeParse(report).success).toBe(true);
    expect(evalReportSchema.safeParse({ ...report, schemaVersion: 2 }).success).toBe(false);
    const json = JSON.stringify(report);
    for (const account of mailbox.accounts)
      for (const { message } of readMailbox(account.mbox, {
        accountId: account.id,
        workspaceId: mailbox.workspaceId,
      }).slice(0, 25)) {
        expect(json).not.toContain(message.subject);
        expect(json).not.toContain(message.from);
      }
  });
});

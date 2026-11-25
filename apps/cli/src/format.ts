import { EMAIL_TYPES } from "@pochimail/classification/model/email-type";
import { SIGNAL_KINDS } from "@pochimail/classification/model/signal";
import type { ScenarioResult } from "./scenario.ts";
import { SEED } from "./scenario.ts";

const n = (value: number) => value.toLocaleString("en-US");
const ratio = (value: number) => value.toFixed(2);

/** The printed summary: counts and ratios only, never a subject, address or snippet. */
export function formatSummary(dataset: string, r: ScenarioResult): string[] {
  const { summary, scan, eval: ev } = r;
  const lines = [
    `pochi run ${dataset} (seed ${SEED}, ${r.scale}), all in memory`,
    `sync        ${summary.accounts} accounts · ${n(summary.emails)} emails · ${n(scan.batches)} batches · ${scan.pauses} pauses · ${scan.deferred} deferred`,
    `classify    ${EMAIL_TYPES.map((c) => `${c} ${n(summary.categories[c])}`).join(" · ")}`,
    `signals     ${SIGNAL_KINDS.map((k) => `${k} ${n(summary.signals[k])}`).join(" · ")}`,
    `catch       ${summary.waiting} people waiting (oldest ${summary.oldestWaitingDays} days) · ${summary.signals["time-sensitive"]} time-sensitive · ${summary.signals["important-sender"]} from important people · ${summary.signals["has-document"]} documents`,
    `suggest     ${r.suggestions.archive} archive · ${r.suggestions.unsubscribe} unsubscribe (never sent: cannot be undone)`,
    `apply       approved as archives · ${count(r.applied, "applied")} applied · ${count(r.applied, "refused")} refused · ${count(r.applied, "failed")} failed`,
    `undo        ${count(r.undone, "undone")} undone · ${count(r.undone, "failed")} failed · mailbox restored: ${r.mailboxRestored ? "yes" : "NO"}`,
    `eval        type accuracy ${ratio(ev.categoryAccuracy)} · ${n(ev.fixture.messages)} labelled · ${ev.unclassified} unclassified`,
  ];
  for (const c of EMAIL_TYPES) {
    const m = ev.categories[c];
    if (m)
      lines.push(
        `  ${c.padEnd(18)} precision ${ratio(m.precision)} recall ${ratio(m.recall)} support ${m.support}`,
      );
  }
  for (const k of SIGNAL_KINDS) {
    const m = ev.signals[k];
    if (m)
      lines.push(
        `  ${k.padEnd(18)} precision ${ratio(m.precision)} recall ${ratio(m.recall)} support ${m.support}`,
      );
  }
  return lines;
}

function count(outcomes: readonly { status: string }[], status: string): number {
  return outcomes.filter((o) => o.status === status).length;
}

/** Anything that should make the command fail: a stage left work behind, or an outcome went wrong. */
export function problems(r: ScenarioResult): string[] {
  const found: string[] = [];
  if (r.scan.deferred > 0)
    found.push(`${r.scan.deferred} batches failed a stage and were deferred`);
  const bad = r.applied.filter((o) => o.status === "refused" || o.status === "failed").length;
  if (bad > 0) found.push(`${bad} actions were refused or failed`);
  const unreverted = r.undone.filter((o) => o.status === "failed").length;
  if (unreverted > 0) found.push(`${unreverted} undo steps failed`);
  if (!r.changedByApply) found.push("apply did not change the mailbox, so undo proved nothing");
  if (!r.mailboxRestored) found.push("the mailbox differs from its pre-apply state after undo");
  return found;
}

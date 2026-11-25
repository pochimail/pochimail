import type { Clock } from "@pochimail/kernel/clock";
import type { MessageId } from "@pochimail/kernel/ids";
import { unwrap } from "@pochimail/kernel/result";
import { expect } from "vitest";
import type { EmailType } from "../model/email-type.ts";
import type { SignalKind, StoredSignal } from "../model/signal.ts";
import type { SignalSettings } from "../model/signal-settings.ts";
import type { Classifier } from "../ports/classifier.ts";
import type { ClassificationUnitOfWork } from "../ports/unit-of-work.ts";
import { DetectSignals } from "../use-cases/detect-signals.ts";
import { ACCOUNT_1, live, type Seeder, type SeedRow, WS_A } from "./samples.ts";

/** What the signal and classification suites need; in-memory here, SQLite in the db package. */
export interface SignalsHarness extends Seeder {
  readonly uow: ClassificationUnitOfWork;
  readonly clock: Clock & { advance(ms: number): void };
  readonly classifier: Classifier;
  /** Ground-truth labels the classifier answers from. */
  readonly labels: Map<string, EmailType>;
  snapshot(): Promise<unknown>;
}

export const DAY = 86_400_000;
export const idOf = (n: number) => `msg-${n}` as MessageId;

export const ago = (h: SignalsHarness, ms: number) =>
  new Date(h.clock.now().getTime() - ms).toISOString();

export async function detect(
  h: SignalsHarness,
  ids: number[],
  settings?: SignalSettings,
): Promise<readonly StoredSignal[]> {
  return unwrap(
    await new DetectSignals({
      uow: h.uow,
      clock: h.clock,
      ...(settings ? { settings } : {}),
    }).execute({ workspaceId: WS_A, accountId: ACCOUNT_1, messageIds: ids.map(idOf) }, live()),
  );
}

export async function kinds(
  h: SignalsHarness,
  ids: number[],
  settings?: SignalSettings,
): Promise<Map<number, SignalKind[]>> {
  const found = await detect(h, ids, settings);
  return new Map(
    ids.map((n) => [n, found.filter((s) => s.messageId === idOf(n)).map((s) => s.kind)]),
  );
}

/** One positive and one negative fixture: fires on message 1, stays quiet on message 2. */
export async function expectSignal(
  h: SignalsHarness,
  kind: SignalKind,
  positive: SeedRow,
  negative: SeedRow,
  withStats?: () => Promise<void>,
) {
  await h.seed({ 1: positive, 2: negative });
  await withStats?.();
  const got = await kinds(h, [1, 2]);
  expect(got.get(1)).toContain(kind);
  expect(got.get(2)).not.toContain(kind);
}

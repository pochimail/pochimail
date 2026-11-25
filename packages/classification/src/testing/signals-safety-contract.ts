import { unwrap } from "@pochimail/kernel/result";
import { type Check, check, registerContract } from "@pochimail/kernel/testing/contract";
import { expect } from "vitest";
import { signalSettingsSchema } from "../model/signal-settings.ts";
import { UNSURE_CONFIDENCE } from "../policies/signal-rules.ts";
import { EvaluateSuspicious } from "../use-cases/evaluate-suspicious.ts";
import { ACCOUNT_1, WS_A } from "./samples.ts";
import { ago, DAY, detect, idOf, kinds, type SignalsHarness } from "./signals-harness.ts";

const recentFromAlice = (h: SignalsHarness, over: object = {}) => ({
  category: "people" as const,
  message: { from: "alice@example.com", receivedAt: ago(h, DAY), ...over },
});

async function suspiciousIds(h: SignalsHarness, ids: number[]): Promise<number[]> {
  const found = unwrap(
    await new EvaluateSuspicious({ signalFacts: h.uow.reads.signalFacts }).execute({
      workspaceId: WS_A,
      accountId: ACCOUNT_1,
      messageIds: ids.map(idOf),
    }),
  );
  return ids.filter((n) => found.some((f) => f.messageId === idOf(n)));
}

export const signalsSafetyChecks: readonly Check<SignalsHarness>[] = [
  check(
    "an unsure classifier still raises needs-reply at reduced confidence, a sure one does not (guards an unsure email left unprotected, ADR 0012)",
    async (h) => {
      await h.seed({
        1: { ...recentFromAlice(h), category: "newsletters", derived: { confidence: 0.3 } },
        2: { ...recentFromAlice(h), category: "newsletters", derived: { confidence: 0.95 } },
        3: { ...recentFromAlice(h), derived: null },
      });
      const found = await detect(h, [1, 2, 3]);
      const of = (n: number) => found.filter((s) => s.messageId === idOf(n));
      expect(of(1).find((s) => s.kind === "needs-reply")?.confidence).toBe(UNSURE_CONFIDENCE);
      expect(of(3).find((s) => s.kind === "needs-reply")?.confidence).toBe(UNSURE_CONFIDENCE);
      expect(of(2).map((s) => s.kind)).not.toContain("needs-reply");
    },
  ),
  check(
    "an unsure unopened recent message is time-sensitive, an unsure opened one is not (guards a missed deadline on an unclassified email)",
    async (h) => {
      await h.seed({
        1: { derived: { confidence: 0.2 }, message: { receivedAt: ago(h, DAY), opened: false } },
        2: { derived: { confidence: 0.2 }, message: { receivedAt: ago(h, DAY), opened: true } },
      });
      const got = await kinds(h, [1, 2]);
      expect(got.get(1)).toContain("time-sensitive");
      expect(got.get(2)).not.toContain("time-sensitive");
    },
  ),
  check(
    "the recent window is configurable: a 20-day-old person's message needs a reply only under a longer window (guards a hard-coded age)",
    async (h) => {
      await h.seed({ 1: recentFromAlice(h, { receivedAt: ago(h, 20 * DAY) }) });
      expect((await kinds(h, [1])).get(1)).not.toContain("needs-reply");
      const wider = signalSettingsSchema.parse({ recentDays: 30, waitingAfterDays: 3 });
      expect((await kinds(h, [1], wider)).get(1)).toContain("needs-reply");
    },
  ),
  check(
    "the waiting-on-them age is configurable: a 5-day-old thread of yours waits only under a shorter threshold (guards a hard-coded 3 days)",
    async (h) => {
      await h.seed({
        1: recentFromAlice(h, { from: "owner@example.com", receivedAt: ago(h, 5 * DAY) }),
      });
      expect((await kinds(h, [1])).get(1)).toContain("waiting-on-them");
      const slower = signalSettingsSchema.parse({ recentDays: 14, waitingAfterDays: 7 });
      expect((await kinds(h, [1], slower)).get(1)).not.toContain("waiting-on-them");
    },
  ),
  check(
    "suspicious flags a lookalike sender domain and spares a normal one and a sender you answered (guards flagging real mail and missing phishing)",
    async (h) => {
      await h.seed({
        1: { message: { from: "security@id-examp1e-verify.example.net" } },
        2: { message: { from: "security@account.example.net" } },
        3: { message: { from: "friend@examp1e-friends.example.net" } },
      });
      await h.setSender("friend@examp1e-friends.example.net", { repliedCount: 2 });
      expect(await suspiciousIds(h, [1, 2, 3])).toEqual([1]);
    },
  ),
];

export function signalsSafetyContract(make: () => SignalsHarness | Promise<SignalsHarness>): void {
  registerContract("Signals safety and settings", signalsSafetyChecks, make);
}

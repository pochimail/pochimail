import { unwrap } from "@pochimail/kernel/result";
import { type Check, check, registerContract } from "@pochimail/kernel/testing/contract";
import { expect } from "vitest";
import { ClassifyBatch } from "../use-cases/classify-batch.ts";
import { DetectSignals } from "../use-cases/detect-signals.ts";
import { ACCOUNT_1, live, WS_A } from "./samples.ts";
import { ago, DAY, expectSignal, idOf, kinds, type SignalsHarness } from "./signals-harness.ts";

const person = (h: SignalsHarness, days: number, from = "alice@example.com") =>
  ({
    category: "personal",
    message: { from, receivedAt: ago(h, days * DAY) },
  }) as const;

export const signalsChecks: readonly Check<SignalsHarness>[] = [
  check(
    "needs-reply fires for a recent person's message and not for your own, automated mail or an old thread (guards a reply nag)",
    async (h) => {
      await h.seed({
        1: person(h, 1),
        2: person(h, 1, "owner@example.com"),
        3: { ...person(h, 1), message: { receivedAt: ago(h, DAY), hasListUnsubscribe: true } },
        4: { category: "newsletter", message: { receivedAt: ago(h, DAY) } },
        5: person(h, 40),
      });
      const got = await kinds(h, [1, 2, 3, 4, 5]);
      expect(got.get(1)).toContain("needs-reply");
      for (const n of [2, 3, 4, 5]) expect(got.get(n)).not.toContain("needs-reply");
    },
  ),
  check(
    "waiting-on-them fires after 3 quiet days and not the day you wrote or long after (guards an instant nudge and a stale one)",
    async (h) => {
      await h.seed({
        1: person(h, 5, "owner@example.com"),
        2: person(h, 1, "owner@example.com"),
        3: person(h, 40, "owner@example.com"),
      });
      const got = await kinds(h, [1, 2, 3]);
      expect(got.get(1)).toContain("waiting-on-them");
      expect(got.get(2)).not.toContain("waiting-on-them");
      expect(got.get(3)).not.toContain("waiting-on-them");
    },
  ),
  check(
    "important-sender fires for a VIP or often-answered sender and not for a stranger (guards flagging everyone)",
    async (h) =>
      expectSignal(
        h,
        "important-sender",
        { message: { from: "boss@example.com" } },
        { message: { from: "stranger@example.com" } },
        async () => {
          await h.setSender("boss@example.com", { vip: true });
          await h.setSender("stranger@example.com", {});
        },
      ),
  ),
  check(
    "has-document fires on an attachment, protects at 0.5 when the count is unknown, and not at 0 (guards a hidden document being cleaned)",
    async (h) => {
      await h.seed({ 1: { attachmentCount: 2 }, 2: { attachmentCount: 0 }, 3: {} });
      const got = await kinds(h, [1, 2, 3]);
      expect(got.get(1)).toContain("has-document");
      expect(got.get(2)).not.toContain("has-document");
      expect(got.get(3)).toContain("has-document");
      const unknown = unwrap(await h.uow.reads.signals.listForMessages(WS_A, [idOf(3)])).find(
        (s) => s.kind === "has-document",
      );
      expect(unknown?.confidence).toBe(0.5);
      expect(unknown?.reason).toContain("Not sure, kept safe");
    },
  ),
  check(
    "time-sensitive fires on a recent unopened transactional email and not on an opened, old or bulk one (guards missed deadlines and false alarms)",
    async (h) => {
      const recent = (over: object) => ({
        category: "transactional" as const,
        message: { receivedAt: ago(h, 2 * DAY), opened: false, ...over },
      });
      await h.seed({
        1: recent({}),
        2: recent({ opened: true }),
        3: recent({ receivedAt: ago(h, 20 * DAY) }),
        4: { ...recent({}), category: "newsletter" },
      });
      const got = await kinds(h, [1, 2, 3, 4]);
      expect(got.get(1)).toContain("time-sensitive");
      for (const n of [2, 3, 4]) expect(got.get(n)).not.toContain("time-sensitive");
    },
  ),
  check(
    "old-never-opened fires for old unopened bulk mail only, not for opened, recent or a person's mail (guards flagging mail you read)",
    async (h) => {
      const old = ago(h, 45 * DAY);
      await h.seed({
        1: { message: { receivedAt: old, opened: false } },
        2: { message: { receivedAt: old, opened: true } },
        3: { message: { receivedAt: ago(h, 2 * DAY), opened: false } },
        4: { category: "personal", message: { receivedAt: old, opened: false } },
      });
      const got = await kinds(h, [1, 2, 3, 4]);
      expect(got.get(1)).toContain("old-never-opened");
      for (const n of [2, 3, 4]) expect(got.get(n)).not.toContain("old-never-opened");
    },
  ),
  check(
    "signals are identical whatever the input order and are announced once each (guards non-deterministic output and duplicate events)",
    async (h) => {
      await h.seed({
        1: { attachmentCount: 1 },
        2: {
          category: "personal",
          message: { from: "alice@example.com", receivedAt: ago(h, DAY) },
        },
      });
      const run = (ids: number[]) =>
        new DetectSignals({ uow: h.uow, clock: h.clock }).execute(
          { workspaceId: WS_A, accountId: ACCOUNT_1, messageIds: ids.map(idOf) },
          live(),
        );
      const first = unwrap(await run([1, 2]));
      const second = unwrap(await run([2, 1]));
      expect(second).toEqual(first);
      expect(first.length).toBeGreaterThanOrEqual(2);
    },
  ),
  check(
    "signals survive a fresh DetectSignals read without re-detecting, and re-running detection yields identical rows (guards lost or churning signals)",
    async (h) => {
      await h.seed({
        1: { category: "personal" },
        2: { attachmentCount: 1 },
      });
      const request = { workspaceId: WS_A, accountId: ACCOUNT_1, messageIds: [idOf(1), idOf(2)] };
      const first = unwrap(
        await new DetectSignals({ uow: h.uow, clock: h.clock }).execute(request, live()),
      );
      expect(first.length).toBeGreaterThan(0);
      const rowsAfterFirst = JSON.stringify(
        ((await h.snapshot()) as Record<string, unknown>).signals,
      );

      h.clock.advance(DAY);
      const fresh = new DetectSignals({ uow: h.uow, clock: h.clock });
      expect(unwrap(await h.uow.reads.signals.listForMessages(WS_A, request.messageIds))).toEqual(
        first,
      );

      unwrap(await fresh.execute(request, live()));
      expect(JSON.stringify(((await h.snapshot()) as Record<string, unknown>).signals)).toBe(
        rowsAfterFirst,
      );
    },
  ),
  check(
    "classifying records reason, confidence and a capped snippet, and signals leave no body behind (follows proposed D11)",
    async (h) => {
      const BODY = "SECRET-BODY-TEXT-0003";
      const cap = 120;
      await h.seed({
        1: {
          message: { snippet: `${"x".repeat(cap)}${BODY}`, subject: "Invoice due tomorrow" },
          derived: { snippet: "placeholder" },
        },
      });
      h.labels.set("msg-1", "transactional");
      unwrap(
        await new ClassifyBatch({ uow: h.uow, classifier: h.classifier, clock: h.clock }).execute(
          { workspaceId: WS_A, messageIds: [idOf(1)] },
          live(),
        ),
      );
      const stored = unwrap(await h.uow.reads.derived.get(WS_A, idOf(1)));
      expect(stored.snippet.length).toBeLessThanOrEqual(cap);
      expect(stored.reason.length).toBeGreaterThan(0);
      expect(stored.confidence).toBe(1);

      await kinds(h, [1]);
      // The message row keeps what sync stored; everything derived must not.
      const rows = (await h.snapshot()) as Record<string, unknown>;
      for (const name of ["derived", "signals", "outbox"])
        expect(JSON.stringify(rows[name])).not.toContain(BODY);
    },
  ),
];

export function signalsContract(make: () => SignalsHarness | Promise<SignalsHarness>): void {
  registerContract("Signals and classification", signalsChecks, make);
}

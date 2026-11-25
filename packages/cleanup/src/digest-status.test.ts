// Guards: a digest re-reporting old mail, a lost or phantom event, one account's figures on another's Summary, and a pre-upgrade event with no account field.
import type { AccountId } from "@pochimail/kernel/ids";
import { unwrap } from "@pochimail/kernel/result";
import { describe, expect, it } from "vitest";
import { type DigestReady, digestReadyEvent } from "./events.ts";
import { createInMemoryCleanup } from "./testing/in-memory-cleanup.ts";
import { createInMemoryDigestTally } from "./testing/in-memory-digest-tally.ts";
import { ACCOUNT_1, live, WS_A } from "./testing/samples.ts";
import { BuildDigest } from "./use-cases/build-digest.ts";
import { GetDigestStatus } from "./use-cases/get-digest-status.ts";
import { RecordDigestReady } from "./use-cases/record-digest-ready.ts";

const fakeClock = () => {
  let at = Date.parse("2026-01-01T00:00:00.000Z");
  return {
    now: () => new Date(at),
    advance: (ms: number) => {
      at += ms;
    },
  };
};

const digestEvent = (
  id: string,
  accountId: AccountId,
  occurredAt: string,
  payload: Omit<DigestReady["payload"], "accountId">,
): DigestReady => ({
  id,
  type: "DigestReady",
  version: 1,
  workspaceId: WS_A,
  occurredAt,
  payload: { ...payload, accountId },
});

describe("digest status", () => {
  // Guards: a real first scan whose DigestReady carries no per-action figures, leaving the Summary empty.
  it("carries the new items of each action from BuildDigest to the tally", async () => {
    const h = createInMemoryCleanup();
    await h.seed({
      1: { category: "notification" },
      2: { category: "transactional" },
      3: { category: "newsletter" },
      4: { category: "promotion" },
    });
    const clock = fakeClock();
    const digest = unwrap(
      await new BuildDigest({ uow: h.uow, clock }).execute(
        { workspaceId: WS_A, accountId: ACCOUNT_1 },
        live(),
      ),
    );
    const tally = createInMemoryDigestTally();
    for (const event of h.committedEvents())
      if (event.type === "DigestReady")
        new RecordDigestReady({ tally }).execute(digestReadyEvent.parse(event));

    expect(new GetDigestStatus({ tally }).execute(ACCOUNT_1)).toEqual({
      ready: true,
      itemCount: 4,
      archived: 1,
      saved: 1,
      unsubscribed: 1,
      generatedAt: digest.generatedAt,
    });
  });

  it("counts a delivered event once (guards double counting on at-least-once delivery)", () => {
    const tally = createInMemoryDigestTally();
    const record = new RecordDigestReady({ tally });
    const event = {
      id: "digest:acc-1:since",
      type: "DigestReady" as const,
      version: 1 as const,
      workspaceId: WS_A,
      occurredAt: "2026-01-01T00:00:00.000Z",
      payload: { itemCount: 3, accountId: ACCOUNT_1 },
    };
    record.execute(event);
    record.execute(event);
    expect(new GetDigestStatus({ tally }).execute(ACCOUNT_1)).toEqual({
      ready: true,
      itemCount: 3,
      archived: 0,
      saved: 0,
      unsubscribed: 0,
      generatedAt: event.occurredAt,
    });
  });

  // Guards: a second sync showing cumulative figures on the Summary instead of only its new items (#227).
  it("replaces the figures with the newest digest, not their sum", () => {
    const tally = createInMemoryDigestTally();
    const record = new RecordDigestReady({ tally });
    const delivered = (
      id: string,
      at: string,
      payload: Omit<DigestReady["payload"], "accountId">,
      accountId: AccountId = ACCOUNT_1,
    ) => record.execute(digestEvent(id, accountId, at, payload));
    delivered("digest:acc-1:one", "2026-01-01T00:00:00.000Z", {
      itemCount: 3,
      archived: 3,
      saved: 1,
      unsubscribed: 2,
    });
    delivered("digest:acc-1:two", "2026-01-02T00:00:00.000Z", {
      itemCount: 1,
      archived: 0,
      saved: 1,
      unsubscribed: 0,
    });
    delivered("digest:acc-1:one", "2026-01-01T00:00:00.000Z", {
      itemCount: 3,
      archived: 3,
      saved: 1,
      unsubscribed: 2,
    });
    delivered("digest:acc-1:stale", "2025-12-31T00:00:00.000Z", {
      itemCount: 9,
      archived: 9,
      saved: 9,
      unsubscribed: 9,
    });
    expect(new GetDigestStatus({ tally }).execute(ACCOUNT_1)).toEqual({
      ready: true,
      itemCount: 1,
      archived: 0,
      saved: 1,
      unsubscribed: 0,
      generatedAt: "2026-01-02T00:00:00.000Z",
    });
  });

  // Guards: a later digest with no new items leaving old items on the Summary as if they were new.
  it("resets the Summary when the newest digest has no new items", async () => {
    const h = createInMemoryCleanup();
    await h.seed({
      1: { category: "notification" },
      2: { category: "transactional" },
    });
    const clock = fakeClock();
    const build = new BuildDigest({ uow: h.uow, clock });
    const tally = createInMemoryDigestTally();
    const record = new RecordDigestReady({ tally });
    const replay = () => {
      for (const event of h.committedEvents())
        if (event.type === "DigestReady") record.execute(digestReadyEvent.parse(event));
    };
    const first = unwrap(await build.execute({ workspaceId: WS_A, accountId: ACCOUNT_1 }, live()));
    replay();
    expect(new GetDigestStatus({ tally }).execute(ACCOUNT_1)).toMatchObject({
      ready: true,
      itemCount: 2,
      archived: 1,
      saved: 1,
    });

    clock.advance(60_000);
    const second = unwrap(await build.execute({ workspaceId: WS_A, accountId: ACCOUNT_1 }, live()));
    replay();
    expect(second.newMessageCount).toBe(0);
    expect(new GetDigestStatus({ tally }).execute(ACCOUNT_1)).toEqual({
      ready: false,
      itemCount: 0,
      archived: 0,
      saved: 0,
      unsubscribed: 0,
      generatedAt: second.generatedAt,
    });
    expect(first.generatedAt).not.toBe(second.generatedAt);
  });

  // Guards: one account's digest on another account's Summary, and All accounts showing only one.
  it("keeps each account's figures separate and sums their latest digests for All accounts", () => {
    const tally = createInMemoryDigestTally();
    const record = new RecordDigestReady({ tally });
    const other = "acc-2" as AccountId;
    record.execute(
      digestEvent("digest:acc-1:one", ACCOUNT_1, "2026-01-01T00:00:00.000Z", {
        itemCount: 3,
        archived: 2,
      }),
    );
    record.execute(
      digestEvent("digest:acc-2:one", other, "2026-01-02T00:00:00.000Z", {
        itemCount: 1,
        saved: 1,
      }),
    );

    expect(new GetDigestStatus({ tally }).execute(ACCOUNT_1)).toEqual({
      ready: true,
      itemCount: 3,
      archived: 2,
      saved: 0,
      unsubscribed: 0,
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(new GetDigestStatus({ tally }).execute(other)).toEqual({
      ready: true,
      itemCount: 1,
      archived: 0,
      saved: 1,
      unsubscribed: 0,
      generatedAt: "2026-01-02T00:00:00.000Z",
    });
    expect(new GetDigestStatus({ tally }).execute(undefined)).toEqual({
      ready: true,
      itemCount: 4,
      archived: 2,
      saved: 1,
      unsubscribed: 0,
      generatedAt: "2026-01-02T00:00:00.000Z",
    });
  });

  // Guards: a pre-upgrade DigestReady without accountId being dropped instead of counted.
  it("recovers the account from an older event id", () => {
    const tally = createInMemoryDigestTally();
    new RecordDigestReady({ tally }).execute(
      digestReadyEvent.parse({
        id: `digest:${ACCOUNT_1}:1970-01-01T00:00:00.000Z`,
        type: "DigestReady",
        version: 1,
        workspaceId: WS_A,
        occurredAt: "2026-01-01T00:00:00.000Z",
        payload: { itemCount: 2, saved: 2 },
      }),
    );
    expect(new GetDigestStatus({ tally }).execute(ACCOUNT_1)).toEqual({
      ready: true,
      itemCount: 2,
      archived: 0,
      saved: 2,
      unsubscribed: 0,
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
  });
});

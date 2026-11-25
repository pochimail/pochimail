import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventOf, OutputOf } from "../shared/ipc/contract.ts";
import { createSyncKit, mail } from "./test-support/sync-kit.ts";

const kits: Awaited<ReturnType<typeof createSyncKit>>[] = [];
const closers: (() => void)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) close();
  for (const kit of kits.splice(0)) await kit.cleanup();
});

/** Connected accounts over real IPC, each with three scanned messages and the sync events it sees. */
const connected = async (addresses: readonly string[]) => {
  const kit = await createSyncKit(addresses.length);
  kits.push(kit);
  kit.gmails.forEach((gmail, index) => {
    for (let n = 1; n <= 3; n += 1) gmail.add(mail(n, `box${index}`));
  });
  const ids: string[] = [];
  for (const address of addresses) ids.push(await kit.connect(address));
  const { client, close } = kit.rpc();
  closers.push(close);
  const events: EventOf<"app.events">[] = [];
  client.subscribe("app.events", undefined, (event) => events.push(event));
  const scanned = async (accountId?: string) =>
    (await client.call("overview.get", accountId === undefined ? {} : { accountId })).scanned;
  const syncEvents = () => events.filter((event) => event.type === "SyncChanged");
  return { kit, ids, client, events, scanned, syncEvents };
};

const resultOf = (outcome: OutputOf<"sync.now">, accountId: string) =>
  outcome.results.find((entry) => entry.accountId === accountId)?.result;

describe("sync.now over the real IPC layer", () => {
  it("syncs the account named, fetches its new mail and updates the counts", async () => {
    // Guards: a Sync now that answers but never reaches the provider, or never updates the figures.
    const { kit, ids, client, scanned, syncEvents } = await connected(["one@example.test"]);
    const [id] = ids;
    if (id === undefined) throw new Error("an account is expected");
    kit.gmails[0]?.add(mail(4, "box0"));
    expect(await scanned()).toBe(3);

    const outcome = await client.call("sync.now", { accountId: id });
    expect(resultOf(outcome, id)).toMatchObject({ status: "completed", stored: 1 });
    expect(await scanned()).toBe(4);
    await vi.waitFor(() =>
      expect(syncEvents().map((e) => [e.running, e.result?.status])).toEqual([
        [true, undefined],
        [false, "completed"],
      ]),
    );
    expect(await client.call("sync.status", { accountIds: [id] })).toMatchObject([
      { accountId: id, running: false, last: { result: { status: "completed" } } },
    ]);
  });

  it("an expired history id is reported as a restarted sync with nothing lost", async () => {
    // Guards: a Gmail history reset that is neither flagged to the screen nor recovered.
    const { kit, ids, client, scanned } = await connected(["one@example.test"]);
    const [id] = ids;
    if (id === undefined) throw new Error("an account is expected");
    kit.gmails[0]?.expireHistory();
    kit.gmails[0]?.add(mail(4, "box0"));
    expect(resultOf(await client.call("sync.now", { accountId: id }), id)).toMatchObject({
      status: "completed",
      restarted: true,
    });
    expect(await scanned()).toBe(4);
  });

  it("All accounts syncs every account, and a failure on one still syncs the other", async () => {
    // Guards: one account's failure stopping the sync of the others.
    const { kit, ids, client, scanned } = await connected(["one@example.test", "two@example.test"]);
    const [first, second] = ids;
    const [one, two] = kit.gmails;
    if (first === undefined || second === undefined || one === undefined || two === undefined)
      throw new Error("two accounts are expected");
    one.add(mail(4, "box0"));
    two.add(mail(4, "box1"));

    const both = await client.call("sync.now", {});
    expect(both.results.map((entry) => entry.result.status)).toEqual(["completed", "completed"]);
    expect(await scanned(first)).toBe(4);
    expect(await scanned(second)).toBe(4);

    one.add(mail(5, "box0"));
    two.add(mail(5, "box1"));
    one.failNext(500);
    const mixed = await client.call("sync.now", {});
    expect(resultOf(mixed, first)).toEqual({ status: "failed" });
    expect(resultOf(mixed, second)).toMatchObject({ status: "completed", stored: 1 });
    expect(await scanned(first)).toBe(4);
    expect(await scanned(second)).toBe(5);
  });

  it("a second sync.now while one runs joins it: one run, status running until it is done", async () => {
    // Guards: a double click starting two syncs of one account at the same time.
    const { kit, ids, client, scanned } = await connected(["one@example.test"]);
    const [id] = ids;
    if (id === undefined) throw new Error("an account is expected");
    const gmail = kit.gmails[0];
    gmail?.add(mail(4, "box0"));
    const release = kit.hold();
    const historyCalls = () => gmail?.requests().filter((r) => r.path === "history").length ?? 0;
    const before = historyCalls();

    const first = client.call("sync.now", { accountId: id });
    await vi.waitFor(async () =>
      expect(await client.call("sync.status", { accountIds: [id] })).toMatchObject([
        { running: true },
      ]),
    );
    const second = client.call("sync.now", { accountId: id });
    expect(await client.call("sync.status", { accountIds: [id] })).toMatchObject([
      { running: true },
    ]);
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(historyCalls() - before).toBe(1);
    expect(await scanned()).toBe(4);
    expect(await client.call("sync.status", { accountIds: [id] })).toMatchObject([
      { running: false },
    ]);
  });

  it("the scheduler's poll and a manual sync of one account never run at the same time", async () => {
    // Guards: the poll and the button each starting their own sync of one account.
    const { kit, ids, client } = await connected(["one@example.test"]);
    const [id] = ids;
    if (id === undefined) throw new Error("an account is expected");
    const gmail = kit.gmails[0];
    gmail?.add(mail(4, "box0"));
    const release = kit.hold();
    const before = gmail?.requests().filter((r) => r.path === "history").length ?? 0;

    const polling = kit.advance(60_000);
    await vi.waitFor(async () =>
      expect(await client.call("sync.status", { accountIds: [id] })).toMatchObject([
        { running: true },
      ]),
    );
    const manual = client.call("sync.now", { accountId: id });
    // Answered after the manual request reached the worker, which is already waiting on the poll's run.
    await client.call("sync.status", { accountIds: [id] });
    release();
    const [, joined] = await Promise.all([polling, manual]);
    expect(resultOf(joined, id)).toMatchObject({ status: "completed", stored: 1 });
    expect((gmail?.requests().filter((r) => r.path === "history").length ?? 0) - before).toBe(1);
  });

  const failures = [
    {
      name: "offline",
      cause: (kit: Awaited<ReturnType<typeof connected>>["kit"]) => {
        kit.online.value = false;
      },
      result: { status: "offline" },
    },
    {
      name: "a 401 that survives the token refresh",
      cause: (kit: Awaited<ReturnType<typeof connected>>["kit"]) =>
        kit.gmails[0]?.failNext(401, { times: 2 }),
      result: { status: "needs-reauth" },
    },
    {
      name: "a 429",
      cause: (kit: Awaited<ReturnType<typeof connected>>["kit"]) =>
        kit.gmails[0]?.failNext(429, { retryAfter: "120" }),
      result: { status: "rate-limited" },
    },
  ] as const;
  for (const { name, cause, result } of failures) {
    it(`${name} answers the matching result and event, and no token reaches the renderer`, async () => {
      // Guards: a failure that is swallowed, mislabelled, or that carries a token or provider message.
      const { kit, ids, client, events, syncEvents } = await connected(["one@example.test"]);
      const [id] = ids;
      if (id === undefined) throw new Error("an account is expected");
      kit.gmails[0]?.add(mail(4, "box0"));
      cause(kit);

      const outcome = await client.call("sync.now", { accountId: id });
      expect(resultOf(outcome, id)).toMatchObject(result);
      await vi.waitFor(() => expect(syncEvents().at(-1)?.result).toMatchObject(result));
      const seen = JSON.stringify([outcome, events]);
      expect(seen).not.toMatch(/access-|refresh-|Bearer|https?:/);
      if (result.status === "rate-limited") {
        const limited = resultOf(outcome, id);
        expect(limited?.status === "rate-limited" && limited.resumeAt).toBeGreaterThan(0);
        // Asking again before it resumes does not call the provider.
        const calls = kit.gmails[0]?.requests().length;
        expect(resultOf(await client.call("sync.now", { accountId: id }), id)).toEqual(limited);
        expect(kit.gmails[0]?.requests().length).toBe(calls);
      }
    });
  }
});

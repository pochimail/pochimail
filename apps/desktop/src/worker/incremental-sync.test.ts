import { afterEach, describe, expect, it } from "vitest";
import { createSyncKit, mail } from "./test-support/sync-kit.ts";

const kits: Awaited<ReturnType<typeof createSyncKit>>[] = [];
afterEach(async () => {
  for (const kit of kits.splice(0)) await kit.cleanup();
});

/** A connected account whose first scan finished over three messages. */
const connected = async (accounts = 1) => {
  const kit = await createSyncKit(accounts);
  kits.push(kit);
  kit.gmails.forEach((gmail, index) => {
    for (let n = 1; n <= 3; n += 1) gmail.add(mail(n, `box${index}`));
  });
  const first = await kit.connect("person@example.test");
  const [gmail] = kit.gmails;
  if (gmail === undefined) throw new Error("a fake mailbox is expected");
  return { kit, first, gmail };
};

const listCalls = (gmail: { requests(): readonly { path: string }[] }) =>
  gmail.requests().filter((r) => r.path === "messages").length;

const historyCalls = (gmail: { requests(): readonly { path: string }[] }) =>
  gmail.requests().filter((r) => r.path === "history").length;

describe("incremental sync after the first scan, on the real database", () => {
  it("new mail shows up after the next poll without a restart", async () => {
    // Guards: mail that stops arriving once the first scan is done.
    const { kit, gmail } = await connected();
    expect(await kit.scanned()).toBe(3);
    const lists = listCalls(gmail);
    gmail.add(mail(4, "box0"));
    await kit.advance(30_000);
    expect(await kit.scanned()).toBe(3);
    await kit.advance(60_000);
    expect(await kit.scanned()).toBe(4);
    gmail.add(mail(5, "box0"));
    await kit.advance(60_000);
    expect(await kit.scanned()).toBe(5);
    // The poll continues from the first scan's cursor: it reads history, not the whole mailbox.
    expect(listCalls(gmail)).toBe(lists);
  });

  it("an expired history id relists the mailbox and loses nothing, then deltas continue", async () => {
    // Guards: a Gmail history reset that silently drops the mail that arrived while it was unreadable.
    const { kit, gmail } = await connected();
    await kit.advance(60_000);
    gmail.add(mail(4, "box0"));
    gmail.expireHistory();
    gmail.add(mail(5, "box0"));
    const listsBefore = listCalls(gmail);
    await kit.advance(60_000);
    expect(await kit.scanned()).toBe(5);
    expect(listCalls(gmail)).toBeGreaterThan(listsBefore);
    const listsAfter = listCalls(gmail);
    gmail.add(mail(6, "box0"));
    await kit.advance(60_000);
    expect(await kit.scanned()).toBe(6);
    expect(listCalls(gmail)).toBe(listsAfter);
  });

  it("a rate limit waits for resumeAt and then resumes by itself", async () => {
    // Guards: a poll that hammers a rate-limited account, or one that never comes back.
    const { kit, gmail } = await connected();
    gmail.add(mail(4, "box0"));
    gmail.failNext(429, { retryAfter: "150" });
    await kit.advance(60_000);
    expect(await kit.scanned()).toBe(3);
    const calls = historyCalls(gmail);
    await kit.advance(60_000);
    expect(historyCalls(gmail)).toBe(calls);
    await kit.advance(120_000);
    expect(await kit.scanned()).toBe(4);
  });

  it("an offline interval is retried at the next tick and syncs once the network is back", async () => {
    // Guards: an offline poll that stops the schedule for good.
    const { kit, gmail } = await connected();
    gmail.add(mail(4, "box0"));
    kit.online.value = false;
    await kit.advance(120_000);
    expect(await kit.scanned()).toBe(3);
    kit.online.value = true;
    await kit.advance(60_000);
    expect(await kit.scanned()).toBe(4);
  });

  it("polls at the focused cadence, slows to the visible one, stops while hidden and resumes on show", async () => {
    // Guards: an account polled every minute while the window is idle, or still polled once it is hidden.
    const { kit, gmail } = await connected();
    const polls = () => historyCalls(gmail);
    const base = polls();
    await kit.advance(60_000);
    expect(polls() - base).toBe(1);

    kit.activity.set("visible");
    await kit.advance(240_000);
    expect(polls() - base).toBe(1);
    await kit.advance(60_000);
    expect(polls() - base).toBe(2);

    kit.activity.set("hidden");
    await kit.advance(3_600_000, 300_000);
    expect(polls() - base).toBe(2);

    gmail.add(mail(4, "box0"));
    kit.activity.set("focused");
    await kit.advance(60_000);
    expect(await kit.scanned()).toBe(4);
    expect(polls() - base).toBe(3);
  });

  it("sleep and going offline pause polling, and waking resumes it", async () => {
    // Guards: polling a sleeping or offline machine, or never resuming afterwards.
    const { kit, gmail } = await connected();
    kit.power.sleep();
    gmail.add(mail(4, "box0"));
    const calls = historyCalls(gmail);
    await kit.advance(300_000);
    expect(historyCalls(gmail)).toBe(calls);
    kit.power.wake();
    await kit.advance(120_000);
    expect(await kit.scanned()).toBe(4);
    kit.power.goOffline();
    gmail.add(mail(5, "box0"));
    await kit.advance(300_000);
    expect(await kit.scanned()).toBe(4);
    kit.power.goOnline();
    await kit.advance(120_000);
    expect(await kit.scanned()).toBe(5);
  });

  it("quitting stops the polling, and a relaunch resumes from the stored cursor", async () => {
    // Guards: a poll that outlives the worker, or a relaunch that rereads the whole mailbox.
    const { kit, gmail } = await connected();
    await kit.advance(60_000);
    await kit.quit();
    gmail.add(mail(4, "box0"));
    const requests = gmail.requests().length;
    await kit.advance(300_000);
    expect(gmail.requests().length).toBe(requests);

    await kit.restart();
    const lists = listCalls(gmail);
    await kit.advance(60_000);
    expect(await kit.scanned()).toBe(4);
    expect(listCalls(gmail)).toBe(lists);
  });

  it("two accounts poll independently: one rate-limited account does not hold back the other", async () => {
    // Guards: one account's failure or wait stalling another account's sync.
    const { kit, first } = await connected(2);
    const second = await kit.connect("second@example.test");
    const [one, two] = kit.gmails;
    if (one === undefined || two === undefined) throw new Error("two mailboxes expected");
    one.add(mail(4, "box0"));
    two.add(mail(4, "box1"));
    one.failNext(429, { retryAfter: "600" });
    await kit.advance(120_000);
    const scanned = async (id: string) =>
      ((await kit.call("overview.get", { accountId: id })) as { scanned: number }).scanned;
    expect(await scanned(first)).toBe(3);
    expect(await scanned(second)).toBe(4);
  });
});

type Counts = Record<string, number>;
const categories = async (kit: Awaited<ReturnType<typeof createSyncKit>>) =>
  (await kit.call("mailbox.categories", { accountIds: await accountIds(kit) })) as Counts;
const accountIds = async (kit: Awaited<ReturnType<typeof createSyncKit>>) =>
  ((await kit.call("accounts.list")) as { id: string }[]).map((a) => a.id);

describe("mail that the sync stores after the first scan", () => {
  const newsletter = (n: number) => mail(n, "box0", { hasListUnsubscribe: true });

  it("is classified like first-scan mail with the same facts, and the counts include it", async () => {
    // Guards: new mail that is stored but never gets a type, so it is filed under the default label forever.
    const { kit, gmail } = await connected();
    gmail.add(newsletter(4));
    gmail.add(mail(5, "box0"));
    await kit.advance(60_000);
    expect(await kit.scanned()).toBe(5);
    const counts = await categories(kit);
    // The three plain mails of the first scan and the plain one synced later have the same facts: one type.
    expect(counts.people).toBe(4);
    expect(counts.newsletters).toBe(1);
    expect(counts.notifications).toBe(0);
  });

  it("is stored with the cursor advanced when the classifier is down, and classified once on the next run with no repeated event", async () => {
    // Guards: a classifier outage that loses the mail, stalls the cursor, or classifies the same mail twice.
    const { kit, gmail } = await connected();
    kit.classifier.makeUnavailable();
    gmail.add(newsletter(4));
    await kit.advance(60_000);
    expect(await kit.scanned()).toBe(4);
    expect((await categories(kit)).newsletters).toBe(0);
    const calls = gmail.requests().length;

    kit.classifier.faults.clear();
    await kit.advance(60_000);
    expect((await categories(kit)).newsletters).toBe(1);
    // The mail was not read again: the second run only caught up on what was left unclassified.
    expect(
      gmail
        .requests()
        .slice(calls)
        .filter((r) => r.path.startsWith("messages/")),
    ).toEqual([]);
    await kit.advance(60_000);

    const ids = await kit.committedEventIds();
    expect(ids.filter((id) => id.startsWith("classified:box0-m4:"))).toEqual([
      "classified:box0-m4:newsletters",
    ]);
  });

  it("is never offered for clean-up while unclassified, and is once the classifier has decided", async () => {
    // Guards: unclassified mail, filed under the default label, counted or proposed as clean-up (ADR 0012).
    const { kit, gmail } = await connected();
    kit.classifier.makeUnavailable();
    for (const n of [4, 5, 6]) gmail.add(newsletter(n));
    await kit.advance(60_000);
    expect(await kit.scanned()).toBe(6);
    const cleanable = async () =>
      ((await kit.call("overview.get", {})) as { cleanable: unknown[] }).cleanable;
    expect(await cleanable()).toEqual([]);

    kit.classifier.faults.clear();
    await kit.advance(60_000);
    expect((await cleanable()).length).toBeGreaterThan(0);
  });

  it("does not replace the first scan's final count with the sync's", async () => {
    // Guards: a delta run announcing its own total as scan progress, so the screen shows a smaller number.
    const { kit, gmail, first } = await connected();
    gmail.add(mail(4, "box0"));
    await kit.advance(60_000);
    const finals = kit.events.filter((e) => e.type === "ScanCompleted" && e.accountId === first);
    expect(finals).toEqual([expect.objectContaining({ processed: 3 })]);
  });
});

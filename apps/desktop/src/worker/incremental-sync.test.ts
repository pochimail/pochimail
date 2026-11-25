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

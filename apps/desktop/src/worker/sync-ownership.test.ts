import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventOf } from "../shared/ipc/contract.ts";
import { createSyncKit, mail } from "./test-support/sync-kit.ts";

const kits: Awaited<ReturnType<typeof createSyncKit>>[] = [];
const closers: (() => void)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) close();
  for (const kit of kits.splice(0)) await kit.cleanup();
});

const start = async () => {
  const kit = await createSyncKit(1);
  kits.push(kit);
  const gmail = kit.gmails[0];
  if (gmail === undefined) throw new Error("a fake mailbox is expected");
  for (let n = 1; n <= 3; n += 1) gmail.add(mail(n, "box0"));
  const { client, close } = kit.rpc();
  closers.push(close);
  return { kit, gmail, client };
};

const count = (
  kit: Awaited<ReturnType<typeof createSyncKit>>,
  type: EventOf<"app.events">["type"],
) => kit.events.filter((event) => event.type === type).length;

describe("who runs an account's sync, and when", () => {
  it("retries a failed first scan quietly at each tick and finishes it once the provider answers", async () => {
    // Guards: a failed first scan that is forgotten (mail never syncs) or announced again at every tick (a toast per minute).
    const { kit, gmail } = await start();
    gmail.failNext(500, { times: 1000 });
    const id = await kit.connect("one@example.test", { waitForScan: false });
    await vi.waitFor(() => expect(count(kit, "ScanFailed")).toBe(1));
    await kit.advance(180_000);
    expect(count(kit, "ScanFailed")).toBe(1);
    expect(await kit.scanned()).toBe(0);

    gmail.failNext(500, { times: 0 });
    await kit.advance(120_000);
    await vi.waitFor(async () => expect(await kit.scanned()).toBe(3));
    expect(count(kit, "ScanCompleted")).toBe(1);
    expect(id).not.toBe("");
  });

  it("does not restart a first scan the person cancelled, until they ask for a sync", async () => {
    // Guards: the scheduler resurrecting a scan the person stopped.
    const { kit, gmail, client } = await start();
    const release = kit.hold();
    const id = await kit.connect("one@example.test", { waitForScan: false });
    const [job] = await client.call("scan.status", { accountIds: [id] });
    if (job === undefined) throw new Error("the scan is expected to be running");
    await client.call("scan.cancel", { jobId: job.jobId });
    release();
    await kit.advance(60_000);
    const requests = gmail.requests().length;
    await kit.advance(240_000);
    expect(gmail.requests().length).toBe(requests);

    await client.call("sync.now", { accountId: id });
    await vi.waitFor(async () => expect(await kit.scanned()).toBe(3));
  });

  it("leaves an account whose sign-in expired alone until it signs in again", async () => {
    // Guards: a dead sign-in polled at every tick, flapping the reconnect banner on and off.
    const { kit, gmail, client } = await start();
    const id = await kit.connect("one@example.test");
    gmail.failNext(401, { times: 2 });
    await kit.advance(60_000);
    const status = () => client.call("sync.status", { accountIds: [id] });
    expect(await status()).toMatchObject([{ last: { result: { status: "needs-reauth" } } }]);
    const requests = gmail.requests().length;
    const states = count(kit, "SyncChanged");
    await kit.advance(180_000);
    expect(gmail.requests().length).toBe(requests);
    expect(await status()).toMatchObject([{ last: { result: { status: "needs-reauth" } } }]);
    expect(count(kit, "SyncChanged")).toBeGreaterThanOrEqual(states);

    await kit.connect("one@example.test");
    gmail.add(mail(4, "box0"));
    await kit.advance(180_000);
    expect(await kit.scanned()).toBe(4);
  });

  it("starts a scan only after the account's sync in flight has ended", async () => {
    // Guards: a scan and a sync advancing one account's cursor at the same time.
    const { kit, gmail, client } = await start();
    const id = await kit.connect("one@example.test");
    gmail.add(mail(4, "box0"));
    const release = kit.hold();
    const polling = kit.advance(60_000);
    await vi.waitFor(async () =>
      expect(await client.call("sync.status", { accountIds: [id] })).toMatchObject([
        { running: true },
      ]),
    );
    let started = false;
    const scan = client.call("scan.start", { accountId: id }).then(() => {
      started = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(started).toBe(false);
    release();
    await Promise.all([polling, scan]);
    expect(started).toBe(true);
    expect(await kit.scanned()).toBe(4);
  });
});

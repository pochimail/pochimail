import { afterEach, describe, expect, it } from "vitest";
import {
  closeHarnesses,
  eventually,
  type RuntimeHarness,
  startRuntimeHarness,
} from "../test-support/accounts-runtime-harness.ts";

afterEach(closeHarnesses);

const FIRST = "first@example.test";
const SECOND = "second@example.test";
const MAILBOX = 150;

const types = (h: RuntimeHarness, accountId: string) =>
  h.events.flatMap((event) =>
    "accountId" in event && event.accountId === accountId ? [event.type] : [],
  );
const secretOf = async (h: RuntimeHarness, accountId: string) => {
  const stored = await h.secrets.get(
    `account/wsp_00000000-0000-4000-8000-000000000001/${accountId}`,
  );
  return stored.ok ? stored.value : null;
};

/** One account whose Gmail refuses every page after the first: the first page is scanned, then the grant "dies". */
const expiredMidScan = async () => {
  const h = await startRuntimeHarness();
  h.fill(FIRST, MAILBOX);
  h.refuseGmail(FIRST, (url) => url.includes("pageToken"));
  const accountId = await h.connect(FIRST);
  await eventually(() => expect(types(h, accountId)).toContain("NeedsReauth"));
  return { h, accountId };
};

describe("token expiry and reconnect over the real worker", () => {
  it("a 401 after the token refresh marks the account needs_reauth, once, and leaks no token (guards an account that stays 'syncing' with a dead token)", async () => {
    const h = await startRuntimeHarness();
    h.fill(FIRST, 3);
    h.refuseGmail(FIRST, () => true);
    const accountId = await h.connect(FIRST);
    await eventually(() => expect(types(h, accountId)).toContain("ScanFailed"));
    await h.idle();

    expect(h.events.filter((event) => event.type === "NeedsReauth")).toEqual([
      { type: "NeedsReauth", accountId, provider: "Gmail" },
    ]);
    expect(h.events).toContainEqual({ type: "ScanFailed", accountId, reason: "auth-expired" });
    // The first 401 forced one refresh; the second 401 is what condemned the grant.
    expect(h.oauth.refreshRequests()).toBeGreaterThanOrEqual(2);
    expect(await h.client.call("scan.status", { accountIds: [accountId] })).toEqual([]);
    expect(JSON.stringify(h.events)).not.toMatch(/refresh-|access-/);
  });

  it("reconnecting stores the new token, emits Reconnected and the scan resumes from the stored cursor (guards a rescan from zero or a scan that never restarts)", async () => {
    const { h, accountId } = await expiredMidScan();
    await h.idle();
    const scannedBefore = (await h.client.call("overview.get", { accountId })).scanned;
    // The first page is scanned and kept; the rest waits for the reconnect.
    expect(scannedBefore).toBeGreaterThan(0);
    expect(scannedBefore).toBeLessThan(MAILBOX);
    const oldToken = await secretOf(h, accountId);

    h.refuseGmail(FIRST, undefined);
    const requestsBefore = h.mailbox(FIRST).requests().length;
    h.oauth.signInAs(FIRST);
    expect(await h.client.call("accounts.reconnect", { accountId })).toEqual({
      status: "reconnected",
    });
    await eventually(() => expect(types(h, accountId)).toContain("ScanCompleted"));

    expect(h.events).toContainEqual({ type: "Reconnected", accountId });
    expect(await secretOf(h, accountId)).not.toBe(oldToken);
    expect((await h.client.call("overview.get", { accountId })).scanned).toBe(MAILBOX);
    const resumed = h
      .mailbox(FIRST)
      .requests()
      .slice(requestsBefore)
      .filter((request) => request.path === "profile" || request.path === "messages");
    expect(resumed.length).toBeGreaterThan(0);
    expect(resumed.every((request) => request.query.has("pageToken"))).toBe(true);
    expect(JSON.stringify(h.events)).not.toMatch(/refresh-|access-/);
  });

  it("a reconnect the person cancels leaves the account needing a reconnect and keeps its token (guards a half-reconnected account)", async () => {
    const { h, accountId } = await expiredMidScan();
    const oldToken = await secretOf(h, accountId);

    h.oauth.denyNextConsent();
    expect(await h.client.call("accounts.reconnect", { accountId })).toEqual({
      status: "cancelled",
    });

    expect(types(h, accountId)).not.toContain("Reconnected");
    expect(await secretOf(h, accountId)).toBe(oldToken);
    expect(await h.client.call("accounts.list")).toHaveLength(1);
  });

  it("a sign-in for another mailbox is refused and revoked, and never replaces the token (guards one account holding another's grant)", async () => {
    const { h, accountId } = await expiredMidScan();
    const oldToken = await secretOf(h, accountId);

    h.oauth.signInAs(SECOND);
    expect(await h.client.call("accounts.reconnect", { accountId })).toEqual({
      status: "failed",
      reason: "wrong-account",
    });

    expect(await secretOf(h, accountId)).toBe(oldToken);
    expect(types(h, accountId)).not.toContain("Reconnected");
    expect(await h.client.call("accounts.list")).toHaveLength(1);
    expect(h.oauth.requests().filter((request) => request.path === "/revoke")).toHaveLength(1);
  });

  it("an unknown account id fails with a closed reason (guards a reconnect that signs in for nothing)", async () => {
    const h = await startRuntimeHarness();
    expect(await h.client.call("accounts.reconnect", { accountId: "acc_missing" })).toEqual({
      status: "failed",
      reason: "not-found",
    });
    expect(h.oauth.requests().filter((request) => request.path === "/authorize")).toEqual([]);
  });

  it("another account keeps syncing while the first needs a reconnect (guards one dead token stopping every account)", async () => {
    const h = await startRuntimeHarness();
    h.fill(FIRST, 3);
    h.fill(SECOND, 5);
    h.refuseGmail(FIRST, () => true);
    const first = await h.connect(FIRST);
    const second = await h.connect(SECOND);
    await eventually(() => expect(types(h, second)).toContain("ScanCompleted"));

    expect(types(h, first)).toContain("NeedsReauth");
    expect(types(h, second)).not.toContain("NeedsReauth");
    expect((await h.client.call("overview.get", { accountId: second })).scanned).toBe(5);
    expect((await h.client.call("overview.get", { accountId: first })).scanned).toBe(0);
  });
});

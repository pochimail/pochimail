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
const WORKSPACE = "wsp_00000000-0000-4000-8000-000000000001";

const secretOf = async (h: RuntimeHarness, accountId: string) => {
  const stored = await h.secrets.get(`account/${WORKSPACE}/${accountId}`);
  return stored.ok ? stored.value : null;
};
const scanned = (h: RuntimeHarness, accountId: string) =>
  eventually(() =>
    expect(h.events).toContainEqual(expect.objectContaining({ type: "ScanCompleted", accountId })),
  );
const cursorsOf = (h: RuntimeHarness, accountId: string) =>
  h.sql("SELECT scope, token FROM cursor WHERE account_id = ?", accountId);

/** Two scanned accounts, the first with 6 emails and the second with 9. */
const twoAccounts = async () => {
  const h = await startRuntimeHarness();
  h.fill(FIRST, 6);
  h.fill(SECOND, 9);
  const first = await h.connect(FIRST);
  const second = await h.connect(SECOND);
  await scanned(h, first);
  await scanned(h, second);
  return { h, first, second };
};

describe("accounts.remove over the real worker", () => {
  it("removes one account's data, token and access and leaves the other untouched (guards a removal that wipes or keeps the wrong account)", async () => {
    const { h, first, second } = await twoAccounts();
    const secondCategories = await h.client.call("mailbox.categories", { accountIds: [second] });
    const secondCursors = cursorsOf(h, second);
    expect(secondCursors.length).toBeGreaterThan(0);
    const firstToken = await secretOf(h, first);
    expect(firstToken).toMatch(/^refresh-/);
    expect(h.rowsOf(first)).toBeGreaterThan(0);

    expect(await h.client.call("accounts.remove", { accountId: first })).toEqual({
      status: "removed",
      remoteRevoked: true,
    });

    expect((await h.client.call("accounts.list")).map((account) => account.id)).toEqual([second]);
    expect((await h.client.call("overview.get", {})).scanned).toBe(9);
    expect(await h.client.call("mailbox.categories", { accountIds: [first] })).toEqual(
      Object.fromEntries(Object.keys(secondCategories).map((category) => [category, 0])),
    );
    expect(await h.client.call("mailbox.categories", { accountIds: [second] })).toEqual(
      secondCategories,
    );
    expect(cursorsOf(h, second)).toEqual(secondCursors);
    expect(h.rowsOf(first)).toBe(0);
    expect(await secretOf(h, first)).toBeNull();
    expect(await secretOf(h, second)).toMatch(/^refresh-/);
    const revoked = h.oauth.requests().filter((request) => request.path === "/revoke");
    expect(revoked.map((request) => request.params.token)).toEqual([firstToken]);
    await eventually(() =>
      expect(h.events).toContainEqual({ type: "AccountRemoved", accountId: first }),
    );
    expect(JSON.stringify(h.events)).not.toMatch(/refresh-|access-/);
  });

  it("an offline provider still removes locally and answers remoteRevoked false (guards a credential kept on the device when the network is down)", async () => {
    const { h, first } = await twoAccounts();
    h.setRevocationOffline(true);

    expect(await h.client.call("accounts.remove", { accountId: first })).toEqual({
      status: "removed",
      remoteRevoked: false,
    });

    expect(await secretOf(h, first)).toBeNull();
    expect(h.rowsOf(first)).toBe(0);
    expect(await h.client.call("accounts.list")).toHaveLength(1);
  });

  it("keeps the account's action-log entries as a record without their command, so nothing can be undone (guards an undo of a removed account's action)", async () => {
    const { h, first } = await twoAccounts();
    h.sql(
      `INSERT INTO action_log (workspace_id, id, action_id, idempotency_key, outcome, account_id, command_kind,
         message_count, inverse_kind, command, inverse, irreversible, at)
       VALUES (?, 'log-1', 'act-1', 'key-1', 'applied', ?, 'archive', 2, 'unarchive', '{"ids":["m1"]}', '{"ids":["m1"]}', 0, '2026-11-21T10:00:00.000Z')`,
      WORKSPACE,
      first,
    );

    await h.client.call("accounts.remove", { accountId: first });

    expect(h.sql("SELECT id, command_kind, command, inverse FROM action_log")).toEqual([
      { id: "log-1", command_kind: "archive", command: null, inverse: null },
    ]);
  });

  it("removing during a running scan stops it and no row of the account comes back (guards a scan writing into a deleted account)", async () => {
    const h = await startRuntimeHarness();
    h.fill(FIRST, 150);
    const hold = h.holdGmail(FIRST, (url) => url.includes("pageToken"));
    const first = await h.connect(FIRST);
    await eventually(() => expect(hold.reached).toBe(true));
    expect(await h.client.call("scan.status", { accountIds: [first] })).toHaveLength(1);
    expect(h.rowsOf(first)).toBeGreaterThan(1);

    expect(await h.client.call("accounts.remove", { accountId: first })).toMatchObject({
      status: "removed",
    });
    hold.release();
    await h.idle();

    expect(await h.client.call("scan.status", { accountIds: [first] })).toEqual([]);
    expect(h.rowsOf(first)).toBe(0);
    expect(h.events.map((event) => event.type)).not.toContain("ScanCompleted");
    expect(await h.client.call("overview.get", {})).toMatchObject({ scanned: 0 });
  });

  it("an unknown id fails with a closed reason and touches nothing (guards a removal that revokes or deletes by mistake)", async () => {
    const { h, second } = await twoAccounts();

    expect(await h.client.call("accounts.remove", { accountId: "acc_missing" })).toEqual({
      status: "failed",
      reason: "not-found",
    });

    expect(h.oauth.requests().filter((request) => request.path === "/revoke")).toEqual([]);
    expect(await h.client.call("accounts.list")).toHaveLength(2);
    expect(h.rowsOf(second)).toBeGreaterThan(0);
  });

  it("removing the last account leaves the app with no connected account (guards a Welcome screen that never returns)", async () => {
    const h = await startRuntimeHarness();
    h.fill(FIRST, 3);
    const first = await h.connect(FIRST);
    await scanned(h, first);
    expect(await h.client.call("app.state")).toMatchObject({ hasConnectedAccount: true });

    await h.client.call("accounts.remove", { accountId: first });

    expect(await h.client.call("app.state")).toEqual({
      status: "ready",
      hasConnectedAccount: false,
      needsReauth: [],
    });
    expect(await h.client.call("accounts.list")).toEqual([]);
    expect(await h.client.call("digest.get", {})).toMatchObject({ ready: false, itemCount: 0 });
  });

  it("refuses to start a scan for an account while its removal is in progress (guards a Retry that writes rows into a deleted account)", async () => {
    const { h, first } = await twoAccounts();
    const revocation = h.holdRevocation();
    const removing = h.client.call("accounts.remove", { accountId: first });
    await eventually(() => expect(revocation.reached).toBe(true));

    await expect(h.client.call("scan.start", { accountId: first })).rejects.toBeDefined();
    revocation.release();
    expect(await removing).toMatchObject({ status: "removed" });
    await h.idle();

    expect(h.rowsOf(first)).toBe(0);
    expect(await h.client.call("scan.status", { accountIds: [first] })).toEqual([]);
  });
});

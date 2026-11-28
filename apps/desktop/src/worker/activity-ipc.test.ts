import { ActionId } from "@pochimail/actions/ids";
import { actionLogSchema } from "@pochimail/actions/model/action";
import { unwrap } from "@pochimail/kernel/result";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT,
  archiveSuggestion,
  mailbox,
  makeAdapters,
  open,
  scanned,
} from "./test-support/cleanup-ipc-harness.ts";

describe("activity over the real IPC layer", () => {
  it("a batch appears as one entry per action, newest first and paged, and undo turns it undone (guards a log that shows rows instead of actions)", async () => {
    // Guards: the pending and final rows listed twice, wrong order, or an entry that never reads undone.
    const { adapters } = await makeAdapters();
    const { client, close } = await scanned(adapters);
    const pick = await archiveSuggestion(adapters, await client.call("cleanup.suggestions", {}));
    const history = (await client.call("activity.list", { limit: 200 })).entries;
    const applied = await client.call("cleanup.apply", {
      accountId: ACCOUNT,
      kind: "archive",
      messageIds: pick.ids,
      confirmed: true,
    });

    const all = (await client.call("activity.list", { limit: 200 })).entries;
    expect(all).toHaveLength(history.length + 1);
    expect(all[0]).toMatchObject({
      batchId: applied.batchId,
      kind: "archive",
      messageCount: pick.ids.length,
      accountId: ACCOUNT,
      outcome: "applied",
      undo: "available",
    });
    const times = all.map((entry) => entry.at);
    expect(times).toEqual([...times].sort().reverse());

    const walked = [];
    let cursor: string | undefined;
    do {
      const page = await client.call("activity.list", { limit: 10, ...(cursor ? { cursor } : {}) });
      walked.push(...page.entries);
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    expect(walked).toEqual(all);

    await client.call("cleanup.undo", { batchId: applied.batchId });
    const after = (await client.call("activity.list", { limit: 200 })).entries;
    expect(after[0]).toMatchObject({ outcome: "undone", undo: "unavailable" });
    expect(after[0]?.actionId).toBe(all[0]?.actionId);
    close();
  });

  it("an unsubscribe reports irreversible and a refused or failed action reports so, and the reply carries no mail data (guards an Undo offered for an unsubscribe)", async () => {
    // Guards: an unsubscribe with an Undo button, or an address in the reply.
    const { adapters, spy } = await makeAdapters();
    const { client, close } = await scanned(adapters);
    const pick = await archiveSuggestion(adapters, await client.call("cleanup.suggestions", {}));
    await client.call("settings.update", { autonomy: "just-look" });
    await client.call("cleanup.apply", {
      accountId: ACCOUNT,
      kind: "archive",
      messageIds: pick.ids,
      confirmed: true,
    });
    await client.call("settings.update", { autonomy: "suggest" });
    spy.failNext = true;
    await client.call("cleanup.apply", {
      accountId: ACCOUNT,
      kind: "trash",
      messageIds: pick.ids,
      confirmed: true,
    });

    const reply = await client.call("activity.list", { limit: 200 });
    expect(reply.entries.find((e) => e.kind === "unsubscribe")).toMatchObject({
      outcome: "applied",
      undo: "irreversible",
    });
    expect(reply.entries[0]).toMatchObject({ kind: "trash", outcome: "failed" });
    expect(reply.entries[1]).toMatchObject({
      kind: "archive",
      outcome: "refused",
      undo: "unavailable",
    });
    const serialized = JSON.stringify(reply);
    expect(serialized).not.toContain("@");
    for (const account of mailbox.accounts) expect(serialized).not.toContain(account.address);
    close();
  });

  it("entries survive a restart and those of a removed account have no undo (guards a log that forgets or offers an impossible undo)", async () => {
    // Guards: a log held in memory, or an Undo that would reach a provider for an account that is gone.
    const { adapters, spy } = await makeAdapters();
    const first = open(adapters);
    const before = await first.client.call("activity.list", { limit: 200 });
    first.close();

    // What removing an account leaves: the entry with placeholder ids, no message to resolve.
    const gone = actionLogSchema.parse({
      schemaVersion: 1,
      id: "log_00000000-0000-4000-8000-0000000000aa",
      workspaceId: adapters.workspaceId,
      actionId: unwrap(ActionId("act_00000000-0000-4000-8000-0000000000aa")),
      idempotencyKey: "gone",
      outcome: "applied",
      command: { kind: "archive", messageIds: ["removed-1", "removed-2"] },
      inverse: { kind: "unarchive", messageIds: ["removed-1", "removed-2"] },
      irreversible: false,
      at: "2099-01-01T00:00:00.000Z",
    });
    const saved = await adapters.uow.run((tx) => tx.repositories.actionLog.append(gone));
    expect(saved.ok).toBe(true);

    const second = open(adapters);
    const after = await second.client.call("activity.list", { limit: 200 });
    expect(after.entries.slice(1)).toEqual(before.entries);
    expect(after.entries[0]).toMatchObject({
      messageCount: 2,
      accountId: null,
      outcome: "applied",
      undo: "unavailable",
    });
    expect(
      await second.client.call("cleanup.undo", { actionId: after.entries[0]?.actionId ?? "" }),
    ).toMatchObject({ undone: 0, failed: 1 });
    expect(spy.calls).toEqual([]);
    second.close();
  });
});

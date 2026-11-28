import { PROTECTING_SIGNALS } from "@pochimail/cleanup/policies/labels";
import { AccountId, MessageId } from "@pochimail/kernel/ids";
import { unwrap } from "@pochimail/kernel/result";
import { describe, expect, it, vi } from "vitest";
import { cleanupMutations } from "../shared/ipc/cleanup-contract.ts";
import { procedureSchemas } from "../shared/ipc/contract.ts";
import {
  ACCOUNT,
  archiveSuggestion,
  idsOf,
  mailbox,
  makeAdapters,
  open,
  scanned,
} from "./test-support/cleanup-ipc-harness.ts";

describe("cleanup over the real IPC layer", () => {
  it("propose after a scan never offers protected mail and its reply carries no address or name (guards a leak or a People email proposed)", async () => {
    // Guards: a suggestion that touches a protected sender, or an address/name in the serialized reply.
    const { adapters } = await makeAdapters();
    const { client, close } = await scanned(adapters);
    const suggestions = await client.call("cleanup.suggestions", {});
    expect(suggestions.length).toBeGreaterThan(0);
    for (const suggestion of suggestions) {
      for (const id of await idsOf(adapters, suggestion.id)) {
        const made = MessageId(id);
        if (!made.ok) throw made.error;
        const message = await adapters.uow.reads.messages.get(adapters.workspaceId, made.value);
        if (!message.ok) throw message.error;
        expect(message.value.category).not.toBe("personal");
        const signals = await adapters.uow.reads.mailboxFacts.signals(
          adapters.workspaceId,
          message.value.accountId,
          [made.value],
          adapters.clock.now(),
        );
        expect(signals.ok && signals.value.some((s) => PROTECTING_SIGNALS.includes(s.kind))).toBe(
          false,
        );
      }
    }
    const serialized = JSON.stringify(suggestions);
    expect(serialized).not.toContain("@");
    for (const account of mailbox.accounts) expect(serialized).not.toContain(account.address);
    expect(await client.call("cleanup.propose", { accountId: ACCOUNT })).toEqual({ created: 0 });
    close();
  });

  it("a confirmed archive then undo restores the Inbox and the figures follow (guards an undo that does not reach the provider or the figures)", async () => {
    // Guards: undo that leaves the Overview figures or the provider out of step.
    const { adapters, spy } = await makeAdapters();
    const { client, events, close } = await scanned(adapters);
    const pick = await archiveSuggestion(adapters, await client.call("cleanup.suggestions", {}));
    const before = (await client.call("overview.get", { accountId: ACCOUNT })).figures.archived;

    const applied = await client.call("cleanup.apply", {
      accountId: ACCOUNT,
      kind: "archive",
      messageIds: pick.ids,
      suggestionId: pick.id,
      confirmed: true,
    });
    expect(applied).toMatchObject({ applied: pick.ids.length, refused: 0, failed: 0 });
    const during = (await client.call("overview.get", { accountId: ACCOUNT })).figures.archived;
    expect(during).toBe(before + pick.ids.length - pick.already);

    expect(await client.call("cleanup.undo", { batchId: applied.batchId })).toMatchObject({
      undone: 1,
      failed: 0,
    });
    expect((await client.call("overview.get", { accountId: ACCOUNT })).figures.archived).toBe(
      before - pick.already,
    );
    expect(spy.calls).toEqual(["archive", "unarchive"]);
    await vi.waitFor(() => {
      const types = events.map((e) => e.type);
      expect(types).toContain("ActionApplied");
      expect(types).toContain("ActionUndone");
    });
    close();
  });

  it("trash then undo restores from the Trash and nothing is ever deleted for good (guards a permanent delete)", async () => {
    // Guards: a trash that is not undone with untrash, or a command that is not a move to the Trash.
    const { adapters, spy } = await makeAdapters();
    const { client, close } = await scanned(adapters);
    const pick = await archiveSuggestion(adapters, await client.call("cleanup.suggestions", {}));
    const applied = await client.call("cleanup.apply", {
      accountId: ACCOUNT,
      kind: "trash",
      messageIds: pick.ids,
      confirmed: true,
    });
    expect(applied.applied).toBe(pick.ids.length);
    await client.call("cleanup.undo", { batchId: applied.batchId });
    expect(spy.calls).toEqual(["trash", "untrash"]);
    const entries = (await client.call("activity.list", { accountIds: [ACCOUNT] })).entries;
    expect(entries[0]).toMatchObject({ kind: "trash", outcome: "undone" });
    close();
  });

  it("Just look refuses and the provider is never called (guards an action run against the chosen autonomy)", async () => {
    // Guards: apply that ignores the stored autonomy.
    const { adapters, spy } = await makeAdapters();
    const { client, close } = await scanned(adapters);
    const pick = await archiveSuggestion(adapters, await client.call("cleanup.suggestions", {}));
    await client.call("settings.update", { autonomy: "just-look" });
    const answer = await client.call("cleanup.apply", {
      accountId: ACCOUNT,
      kind: "archive",
      messageIds: pick.ids,
      confirmed: true,
    });
    expect(answer).toMatchObject({ applied: 0, refused: pick.ids.length });
    expect(spy.calls).toEqual([]);
    close();
  });

  it("a protected id sent by the renderer is refused even when confirmed (guards trusting the renderer for protection)", async () => {
    // Guards: a People email archived because the renderer said it was fine.
    const { adapters, spy } = await makeAdapters();
    const { client, close } = await scanned(adapters);
    const people = await adapters.uow.reads.messages.query(adapters.workspaceId, {
      accountId: unwrap(AccountId(ACCOUNT)),
      category: "personal",
      limit: 1,
    });
    const id = people.ok ? people.value.items[0]?.id : undefined;
    expect(id).toBeDefined();
    const answer = await client.call("cleanup.apply", {
      accountId: ACCOUNT,
      kind: "trash",
      messageIds: [id as string],
      confirmed: true,
    });
    expect(answer).toMatchObject({ applied: 0, refused: 1, failed: 0 });
    expect(spy.calls).toEqual([]);
    close();
  });

  it("the same batch applied twice reaches the provider once, also after a restart (guards a double click)", async () => {
    // Guards: two provider calls for one intent.
    const { adapters, spy } = await makeAdapters();
    const first = await scanned(adapters);
    const pick = await archiveSuggestion(
      adapters,
      await first.client.call("cleanup.suggestions", {}),
    );
    const request = {
      accountId: ACCOUNT,
      kind: "archive" as const,
      messageIds: pick.ids,
      confirmed: true as const,
    };
    const [one, two] = await Promise.all([
      first.client.call("cleanup.apply", request),
      first.client.call("cleanup.apply", request),
    ]);
    const three = await first.client.call("cleanup.apply", request);
    expect(spy.calls).toEqual(["archive"]);
    expect(two.batchId).toBe(one.batchId);
    expect(three.batchId).toBe(one.batchId);
    first.close();

    // A restart on the same database: undo still works from the log, and re-applying after it is a new action.
    const second = open(adapters);
    expect(await second.client.call("cleanup.undo", { batchId: one.batchId })).toMatchObject({
      undone: 1,
    });
    expect(spy.calls).toEqual(["archive", "unarchive"]);
    await second.client.call("cleanup.apply", request);
    expect(spy.calls).toEqual(["archive", "unarchive", "archive"]);
    second.close();
  });

  it("a provider failure mid-batch emits ActionFailed and keeps undo for what was applied (guards lost undo after a partial failure)", async () => {
    // Guards: a partial failure that forgets what already changed.
    const { adapters, spy } = await makeAdapters();
    const { client, events, close } = await scanned(adapters);
    const pick = await archiveSuggestion(adapters, await client.call("cleanup.suggestions", {}));
    spy.failNext = true;
    const answer = await client.call("cleanup.apply", {
      accountId: ACCOUNT,
      kind: "archive",
      messageIds: pick.ids,
      confirmed: true,
    });
    expect(answer).toMatchObject({ applied: 1, failed: pick.ids.length - 1 });
    await vi.waitFor(() => expect(events.map((e) => e.type)).toContain("ActionFailed"));
    const listed = await client.call("activity.list", { accountIds: [ACCOUNT] });
    expect(listed.entries[0]).toMatchObject({ outcome: "failed", undo: "available" });
    expect(await client.call("cleanup.undo", { batchId: answer.batchId })).toMatchObject({
      undone: 1,
    });
    close();
  });

  it("the schema rejects delete and an unconfirmed call, and nothing deletes for good (guards the ADR 0012 invariant)", () => {
    // Guards: a way to delete permanently or to act without approval reaching the worker.
    const apply = cleanupMutations["cleanup.apply"].input;
    const base = { accountId: "a", messageIds: ["m"], confirmed: true };
    expect(apply.safeParse({ ...base, kind: "archive" }).success).toBe(true);
    expect(apply.safeParse({ ...base, kind: "delete" }).success).toBe(false);
    expect(apply.safeParse({ ...base, kind: "archive", confirmed: false }).success).toBe(false);
    expect(apply.safeParse({ accountId: "a", messageIds: ["m"], kind: "archive" }).success).toBe(
      false,
    );
    for (const name of ["cleanup.delete", "cleanup.empty", "cleanup.emptyTrash", "trash.empty"])
      expect(procedureSchemas(name)).toBeUndefined();
  });
});

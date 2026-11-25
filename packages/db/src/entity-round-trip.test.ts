import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Category } from "@pochimail/classification/model/category";
import { unwrap } from "@pochimail/kernel/result";
import type { IncomingMessage } from "@pochimail/mailbox/model/message";
import { entityRoundTripContract } from "@pochimail/testing/entity-contract";
import { afterAll } from "vitest";
import { DisplayFieldsCache } from "./mailbox/display-fields-cache.ts";
import { openStorage, type Storage } from "./open-storage.ts";
import { createSqliteCore } from "./sqlite-repositories.ts";

// Entities stored by a repository go through a real (in-memory) encrypted-free SQLite round trip;
// attachments and actions have no table by design (D11: attachments go to the blob store, M6).
function sqliteRoundTrip() {
  // One database for the whole entity suite, closed once it is done (Windows holds file locks).
  let shared:
    | { storage: Storage; core: ReturnType<typeof createSqliteCore>; dir: string }
    | undefined;
  afterAll(() => {
    shared?.storage.close();
    if (shared)
      rmSync(shared.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const connect = () => {
    if (shared === undefined) {
      const dir = mkdtempSync(join(tmpdir(), "pochimail-entities-"));
      const storage = unwrap(openStorage(join(dir, "pochimail.db"), Buffer.alloc(32, 4)));
      shared = {
        storage,
        core: createSqliteCore(storage.writer, {
          cache: new DisplayFieldsCache(),
          senderHasher: storage.senderHasher,
        }),
        dir,
      };
    }
    return shared.core;
  };
  let counter = 0;
  const done = <T>(r: { ok: true; value: T } | { ok: false; error: Error }): T => {
    if (!r.ok) throw r.error;
    return r.value;
  };
  return (value: unknown): unknown => {
    const v = value as Record<string, unknown>;
    const core = connect();
    counter++;
    if (
      "filename" in v ||
      "suggestionId" in v ||
      ("command" in v && "idempotencyKey" in v && !("outcome" in v))
    )
      return JSON.parse(JSON.stringify(value)); // not persisted by any repository
    if ("provider" in v) {
      done(core.accounts.save(v as never));
      return done(core.accounts.get(String(v.workspaceId), String(v.id)));
    }
    if ("from" in v) {
      const m = v as unknown as IncomingMessage & { category?: Category };
      done(core.messages.upsertMany([m]));
      if (m.category !== undefined)
        done(core.messages.setCategory(m.workspaceId, m.id, m.category));
      const stored = done(core.messages.get(m.workspaceId, m.id));
      // The sample carries a fake digest; the real one is checked here, then swapped in for the comparison.
      if (stored.senderHash !== shared?.storage.senderHasher.hash(m.accountId, m.from))
        throw new Error("The stored message lost its sender hash");
      return { ...stored, senderHash: (v as { senderHash?: string }).senderHash };
    }
    if ("messageIds" in v && "lastMessageAt" in v) {
      done(core.threads.upsert(v as never));
      return done(core.threads.get(String(v.workspaceId), String(v.id)));
    }
    if ("messageCount" in v) {
      done(core.senders.upsert(v as never));
      return done(core.senders.get(String(v.workspaceId), String(v.accountId), String(v.address)));
    }
    if ("reasons" in v && "state" in v) {
      done(core.suggestions.save(v as never));
      return done(core.suggestions.get(String(v.workspaceId), String(v.id)));
    }
    if ("kind" in v && "detectedAt" in v) {
      const id = `${String(v.messageId)}#${counter}`;
      const signal = { ...v, messageId: id, reason: "test" } as never;
      done(core.signals.replaceForMessages(String(v.workspaceId), [id], [signal]));
      return {
        ...done(core.signals.listForMessages(String(v.workspaceId), [id]))[0],
        messageId: v.messageId,
      };
    }
    if ("outcome" in v) {
      done(core.actionLog.append(v as never));
      return done(core.actionLog.get(String(v.workspaceId), String(v.id)));
    }
    if ("name" in v) {
      done(core.topics.save(v as never));
      return done(core.topics.get(String(v.workspaceId), String(v.id)));
    }
    throw new Error("unknown entity");
  };
}
entityRoundTripContract(sqliteRoundTrip());

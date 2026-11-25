import { threadSchema } from "@pochimail/mailbox/model/thread";
import type { Database } from "better-sqlite3-multiple-ciphers";
import type { z } from "zod";
import { find, guard, type Row, sqlHelpers } from "../shared/sql.ts";
import { json, text } from "../shared/values.ts";
import type { DisplayFieldsCache } from "./display-fields-cache.ts";

const threadOf = (r: Row, cache: DisplayFieldsCache) => {
  const ws = text(r.workspace_id);
  const id = text(r.id);
  return threadSchema.parse({
    schemaVersion: 1,
    id,
    workspaceId: ws,
    accountId: r.account_id,
    subject: cache.ofThread(ws, id).subject ?? "",
    messageIds: json(r.message_ids),
    lastMessageAt: r.last_message_at,
  });
};

/** Repository over one connection. The subject is cached, never stored (ADR 0014). */
export function createThreadRepository(db: Database, cache: DisplayFieldsCache) {
  const { one, run } = sqlHelpers(db);
  const threads = {
    get: (ws: string, id: string) =>
      find("Thread", () => {
        const r = one("SELECT * FROM thread WHERE workspace_id = ? AND id = ?", ws, id);
        return r === undefined ? undefined : threadOf(r, cache);
      }),
    upsert: (t: z.infer<typeof threadSchema>) =>
      guard(() => {
        const v = threadSchema.parse(t);
        cache.rememberThread(v);
        run(
          `INSERT INTO thread (workspace_id, id, account_id, message_ids, last_message_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (workspace_id, id) DO UPDATE SET account_id = excluded.account_id,
             message_ids = excluded.message_ids, last_message_at = excluded.last_message_at`,
          v.workspaceId,
          v.id,
          v.accountId,
          JSON.stringify(v.messageIds),
          v.lastMessageAt,
        );
      }),
  };

  return threads;
}

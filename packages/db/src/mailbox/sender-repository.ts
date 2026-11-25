import { senderStatsSchema } from "@pochimail/mailbox/model/sender-stats";
import type { Database } from "better-sqlite3-multiple-ciphers";
import type { z } from "zod";
import { decodeCursor, page } from "../shared/paging.ts";
import type { RepositoryContext } from "../shared/repository-context.ts";
import { find, guard, type Row, sqlHelpers } from "../shared/sql.ts";
import { flag, placeholderAddress, text } from "../shared/values.ts";

const senderOf = (r: Row, context: RepositoryContext) => {
  const ws = text(r.workspace_id);
  const account = text(r.account_id);
  const hash = text(r.sender_hash);
  return senderStatsSchema.parse({
    schemaVersion: 1,
    workspaceId: ws,
    accountId: account,
    address: context.cache.ofSender(ws, account, hash).address ?? placeholderAddress(hash),
    messageCount: r.message_count,
    openedCount: r.opened_count,
    repliedCount: r.replied_count,
    lastMessageAt: r.last_message_at,
    vip: flag(r.vip),
  });
};

/** Repository over one connection. Addresses are hashed at rest; the live address stays in memory. */
export function createSenderRepository(db: Database, context: RepositoryContext) {
  const { all, one, run } = sqlHelpers(db);
  const { cache, senderHasher } = context;
  const senders = {
    get: (ws: string, account: string, address: string) =>
      find("Sender", () => {
        const hash = senderHasher.hash(account, address);
        const r = one(
          "SELECT * FROM sender_stats WHERE workspace_id = ? AND account_id = ? AND sender_hash = ?",
          ws,
          account,
          hash,
        );
        return r === undefined ? undefined : senderOf(r, context);
      }),
    list: (ws: string, account: string, p: { limit: number; cursor?: string }) =>
      guard(() => {
        const after = p.cursor === undefined ? undefined : decodeCursor(p.cursor, 1)[0];
        const limit = Math.max(1, Math.floor(p.limit));
        const rows = all(
          `SELECT * FROM sender_stats WHERE workspace_id = ? AND account_id = ?
             ${after === undefined ? "" : "AND sender_hash > ?"} ORDER BY sender_hash LIMIT ?`,
          ws,
          account,
          ...(after === undefined ? [] : [after]),
          limit + 1,
        );
        return page(
          rows,
          limit,
          (r) => senderOf(r, context),
          (r) => [text(r.sender_hash)],
        );
      }),
    upsert: (s: z.infer<typeof senderStatsSchema>) =>
      guard(() => {
        const v = senderStatsSchema.parse(s);
        const hash = senderHasher.hash(v.accountId, v.address);
        cache.rememberSender(v.workspaceId, v.accountId, hash, v.address);
        run(
          `INSERT INTO sender_stats (workspace_id, account_id, sender_hash, message_count, opened_count, replied_count, last_message_at, vip)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (workspace_id, account_id, sender_hash) DO UPDATE SET message_count = excluded.message_count,
             opened_count = excluded.opened_count, replied_count = excluded.replied_count,
             last_message_at = excluded.last_message_at, vip = excluded.vip`,
          v.workspaceId,
          v.accountId,
          hash,
          v.messageCount,
          v.openedCount,
          v.repliedCount,
          v.lastMessageAt,
          v.vip ? 1 : 0,
        );
      }),
  };

  return senders;
}

import {
  CATEGORIES,
  type Category,
  categorySchema,
  DEFAULT_CATEGORY,
} from "@pochimail/classification/model/category";
import { NotFound } from "@pochimail/kernel/errors";
import { err, ok } from "@pochimail/kernel/result";
import type { IncomingMessage } from "@pochimail/mailbox/model/message";
import type { MessageQuery } from "@pochimail/mailbox/ports/message-repository";
import type { Database } from "better-sqlite3-multiple-ciphers";
import { z } from "zod";
import { decodeCursor, page } from "../shared/paging.ts";
import { CHUNK, find, guard, sqlHelpers } from "../shared/sql.ts";
import { countRow, text } from "../shared/values.ts";
import { MESSAGE_COLUMNS, messageOf } from "./message-row.ts";

const categoryCountRow = z.object({ category: categorySchema, value: z.number() });

/** Repository over one connection. */
export function createMessageRepository(db: Database) {
  const { all, one, run, atomic } = sqlHelpers(db);
  // ---- messages and sender stats ----
  const nextSequence = db.prepare(
    "UPDATE ingest_counter SET value = value + 1 WHERE id = 1 RETURNING value",
  );
  const insertMessage = db.prepare(
    `INSERT INTO message (workspace_id, id, account_id, thread_id, sender, recipients, subject, snippet, received_at,
       has_list_unsubscribe, opened, size, saved_count, saved_size, topic_ids, suspicious_reasons, suspicious_confidence, category, ingest_seq)
     VALUES (@workspace_id, @id, @account_id, @thread_id, @sender, @recipients, @subject, @snippet, @received_at,
       @has_list_unsubscribe, @opened, @size, @saved_count, @saved_size, @topic_ids, @suspicious_reasons, @suspicious_confidence, @category,
       @ingest_seq)`,
  );
  // Re-running with the same input changes nothing; category, ingest_seq and the action log's archived marker are never overwritten.
  const updateMessage = db.prepare(
    `UPDATE message SET account_id = @account_id, thread_id = @thread_id, sender = @sender, recipients = @recipients,
       subject = @subject, snippet = @snippet, received_at = @received_at,
       has_list_unsubscribe = @has_list_unsubscribe, opened = @opened, size = @size,
       saved_count = @saved_count, saved_size = @saved_size, topic_ids = @topic_ids,
       suspicious_reasons = @suspicious_reasons, suspicious_confidence = @suspicious_confidence
     WHERE workspace_id = @workspace_id AND id = @id
       AND (account_id IS NOT @account_id OR thread_id IS NOT @thread_id OR sender IS NOT @sender
         OR recipients IS NOT @recipients OR subject IS NOT @subject OR snippet IS NOT @snippet
         OR received_at IS NOT @received_at OR has_list_unsubscribe IS NOT @has_list_unsubscribe
         OR opened IS NOT @opened OR size IS NOT @size OR saved_count IS NOT @saved_count
         OR saved_size IS NOT @saved_size OR topic_ids IS NOT @topic_ids
         OR suspicious_reasons IS NOT @suspicious_reasons
         OR suspicious_confidence IS NOT @suspicious_confidence)`,
  );
  const bumpSender = db.prepare(
    `INSERT INTO sender_stats (workspace_id, account_id, address, message_count, opened_count, replied_count, last_message_at, vip)
     VALUES (?, ?, ?, 1, ?, 0, ?, 0)
     ON CONFLICT (workspace_id, account_id, address) DO UPDATE SET
       message_count = message_count + 1,
       opened_count = opened_count + excluded.opened_count,
       last_message_at = max(last_message_at, excluded.last_message_at)`,
  );
  const openedFlip = db.prepare(
    `UPDATE sender_stats SET opened_count = opened_count + ? WHERE workspace_id = ? AND account_id = ? AND address = ?`,
  );

  /** Recounts one sender from its messages (rare: a message moved sender, account or date). */
  function recountSender(ws: string, account: string, address: string) {
    const agg = one(
      `SELECT count(*) AS n, coalesce(sum(opened), 0) AS opened, max(received_at) AS last
       FROM message WHERE workspace_id = ? AND account_id = ? AND sender = ?`,
      ws,
      account,
      address,
    );
    if (agg === undefined || agg.n === 0) {
      run(
        `UPDATE sender_stats SET message_count = 0, opened_count = 0
         WHERE workspace_id = ? AND account_id = ? AND address = ?`,
        ws,
        account,
        address,
      );
      run(
        `DELETE FROM sender_stats WHERE workspace_id = ? AND account_id = ? AND address = ?
           AND message_count = 0 AND replied_count = 0 AND vip = 0`,
        ws,
        account,
        address,
      );
      return;
    }
    run(
      `INSERT INTO sender_stats (workspace_id, account_id, address, message_count, opened_count, replied_count, last_message_at, vip)
       VALUES (?, ?, ?, ?, ?, 0, ?, 0)
       ON CONFLICT (workspace_id, account_id, address) DO UPDATE SET
         message_count = excluded.message_count, opened_count = excluded.opened_count,
         last_message_at = excluded.last_message_at`,
      ws,
      account,
      address,
      agg.n,
      agg.opened,
      agg.last,
    );
  }

  const upsertBatch = atomic((batch: readonly IncomingMessage[]) => {
    for (const m of batch) {
      const bound = {
        workspace_id: m.workspaceId,
        id: m.id,
        account_id: m.accountId,
        thread_id: m.threadId,
        sender: m.from,
        recipients: JSON.stringify(m.to),
        subject: m.subject,
        snippet: m.snippet,
        received_at: m.receivedAt,
        has_list_unsubscribe: m.hasListUnsubscribe ? 1 : 0,
        opened: m.opened ? 1 : 0,
        size: m.size ?? null,
        saved_count: m.savedCount ?? null,
        saved_size: m.savedSize ?? null,
        topic_ids: JSON.stringify(m.topicIds),
        suspicious_reasons:
          m.suspicious === undefined ? null : JSON.stringify(m.suspicious.reasons),
        suspicious_confidence: m.suspicious === undefined ? null : m.suspicious.confidence,
      };
      const before = one(
        "SELECT account_id, sender, received_at, opened FROM message WHERE workspace_id = ? AND id = ?",
        m.workspaceId,
        m.id,
      );
      if (before === undefined) {
        const seq = countRow.parse(nextSequence.get()).value;
        insertMessage.run({ ...bound, category: DEFAULT_CATEGORY, ingest_seq: seq });
        bumpSender.run(m.workspaceId, m.accountId, m.from, bound.opened, m.receivedAt);
        continue;
      }
      if (updateMessage.run(bound).changes === 0) continue; // a replay of what is stored
      const moved =
        before.account_id !== m.accountId ||
        before.sender !== m.from ||
        before.received_at !== m.receivedAt;
      if (moved) {
        recountSender(m.workspaceId, String(before.account_id), String(before.sender));
        recountSender(m.workspaceId, m.accountId, m.from);
      } else if (before.opened !== bound.opened) {
        openedFlip.run(bound.opened - Number(before.opened), m.workspaceId, m.accountId, m.from);
      }
    }
  });

  const messages = {
    get: (ws: string, id: string) =>
      find("Message", () => {
        const r = one(
          `SELECT ${MESSAGE_COLUMNS} FROM message WHERE workspace_id = ? AND id = ?`,
          ws,
          id,
        );
        return r === undefined ? undefined : messageOf(r);
      }),
    query: (ws: string, q: MessageQuery) =>
      guard(() => {
        const where = ["workspace_id = ?", "account_id = ?"];
        const params: unknown[] = [ws, q.accountId];
        const filter = (sql: string, value: unknown) => {
          if (value === undefined) return;
          where.push(sql);
          params.push(value);
        };
        filter("category = ?", q.category);
        filter("sender = ?", q.senderAddress);
        filter("ingest_seq > ?", q.afterSequence);
        filter("ingest_seq <= ?", q.throughSequence);
        if (q.cursor !== undefined) {
          const [at, id] = decodeCursor(q.cursor, 2);
          where.push("(received_at < ? OR (received_at = ? AND id > ?))");
          params.push(at, at, id);
        }
        const limit = Math.max(1, Math.floor(q.limit));
        const rows = all(
          `SELECT ${MESSAGE_COLUMNS} FROM message WHERE ${where.join(" AND ")}
           ORDER BY received_at DESC, id ASC LIMIT ?`,
          ...params,
          limit + 1,
        );
        return page(rows, limit, messageOf, (r) => [text(r.received_at), text(r.id)]);
      }),
    latestSequence: (ws: string, account: string) =>
      guard(() => {
        const r = one(
          "SELECT coalesce(max(ingest_seq), 0) AS value FROM message WHERE workspace_id = ? AND account_id = ?",
          ws,
          account,
        );
        return countRow.parse(r).value;
      }),
    countByCategory: (ws: string, accountIds: readonly string[]) =>
      guard(() => {
        const counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<
          Category,
          number
        >;
        if (accountIds.length === 0) return counts;
        const marks = accountIds.map(() => "?").join(", ");
        const rows = all(
          `SELECT category, count(*) AS value FROM message WHERE workspace_id = ? AND account_id IN (${marks}) GROUP BY category`,
          ws,
          ...accountIds,
        );
        for (const r of rows) {
          const { category, value } = categoryCountRow.parse(r);
          counts[category] = value;
        }
        return counts;
      }),
    upsertMany: (batch: readonly IncomingMessage[], signal?: { readonly aborted: boolean }) =>
      guard(() => {
        for (let i = 0; i < batch.length; i += CHUNK) {
          if (signal?.aborted) return; // the unit of work rolls an aborted run back
          upsertBatch(batch.slice(i, i + CHUNK));
        }
      }),
    setCategory: (ws: string, id: string, category: Category) => {
      const r = guard(
        () =>
          run("UPDATE message SET category = ? WHERE workspace_id = ? AND id = ?", category, ws, id)
            .changes,
      );
      if (!r.ok) return r;
      return r.value === 0 ? err(new NotFound("Message")) : ok(undefined);
    },
  };

  return messages;
}

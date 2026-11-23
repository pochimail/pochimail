import type { AccountFigures } from "@pochimail/cleanup/ports/mailbox-facts";
import type { StorageError } from "@pochimail/kernel/errors";
import type { AccountId, WorkspaceId } from "@pochimail/kernel/ids";
import type { Result } from "@pochimail/kernel/result";
import { accountIdSchema } from "@pochimail/kernel/schemas";
import type { Database } from "better-sqlite3-multiple-ciphers";
import { z } from "zod";
import { guard, sqlHelpers } from "../shared/sql.ts";

const figuresRow = z.object({
  account_id: accountIdSchema,
  archived: z.number(),
  saved_count: z.number(),
  saved_size: z.number(),
  deletable_size: z.number(),
  unsubscribed: z.number(),
  total_size: z.number(),
});

/**
 * The Overview figures per account (#114), aggregated in SQL with GROUP BY: no per-message reads.
 * Unknown facts stay out of the sums: NULL sizes and attachment counts add nothing, and only an
 * archived marker of 1 counts. Deletable size follows the latest executed trash/untrash effect per
 * message (an undone entry's command is the inverse that ran), and one applied unsubscribe entry
 * is one sender.
 */
export function overviewFiguresOver(db: Database) {
  const { all } = sqlHelpers(db);
  return (
    ws: WorkspaceId,
    accountIds: readonly AccountId[],
  ): Result<readonly AccountFigures[], StorageError> =>
    guard(() => {
      if (accountIds.length === 0) return [];
      const marks = accountIds.map(() => "?").join(", ");
      const rows = all(
        `WITH stored AS (
           SELECT account_id,
             sum(CASE WHEN archived = 1 THEN 1 ELSE 0 END) AS archived,
             coalesce(sum(saved_count), 0) AS saved_count,
             coalesce(sum(saved_size), 0) AS saved_size,
             coalesce(sum(size), 0) AS total_size
           FROM message WHERE workspace_id = ? AND account_id IN (${marks})
           GROUP BY account_id
         ),
         latest_effect AS (
           SELECT je.value AS message_id, l.command_kind AS kind,
             row_number() OVER (PARTITION BY je.value ORDER BY l.seq DESC) AS rn
           FROM action_log l, json_each(l.command, '$.messageIds') je
           WHERE l.workspace_id = ? AND l.command IS NOT NULL
             AND l.outcome IN ('applied', 'undone') AND l.command_kind IN ('trash', 'untrash')
         ),
         deletable AS (
           SELECT m.account_id, coalesce(sum(m.size), 0) AS deletable_size
           FROM message m
           JOIN latest_effect e ON e.message_id = m.id AND e.rn = 1 AND e.kind = 'trash'
           WHERE m.workspace_id = ? AND m.account_id IN (${marks})
           GROUP BY m.account_id
         ),
         unsubscribed AS (
           SELECT account_id, count(*) AS unsubscribed FROM action_log
           WHERE workspace_id = ? AND outcome = 'applied' AND command_kind = 'unsubscribe'
             AND account_id IN (${marks})
           GROUP BY account_id
         )
         SELECT s.account_id, s.archived, s.saved_count, s.saved_size, s.total_size,
           coalesce(d.deletable_size, 0) AS deletable_size,
           coalesce(u.unsubscribed, 0) AS unsubscribed
         FROM stored s
         LEFT JOIN deletable d ON d.account_id = s.account_id
         LEFT JOIN unsubscribed u ON u.account_id = s.account_id`,
        ws,
        ...accountIds,
        ws,
        ws,
        ...accountIds,
        ws,
        ...accountIds,
      );
      return rows.map((r) => {
        const f = figuresRow.parse(r);
        return {
          accountId: f.account_id,
          archived: f.archived,
          savedCount: f.saved_count,
          savedSize: f.saved_size,
          deletableSize: f.deletable_size,
          unsubscribed: f.unsubscribed,
          totalSize: f.total_size,
        };
      });
    });
}

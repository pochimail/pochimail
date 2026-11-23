import type { AccountFigures } from "@pochimail/cleanup/ports/mailbox-facts";
import type { StorageError } from "@pochimail/kernel/errors";
import type { AccountId, WorkspaceId } from "@pochimail/kernel/ids";
import { ok, type Result } from "@pochimail/kernel/result";
import type { Data } from "../in-memory-store-data.ts";
import { key } from "../in-memory-store-data.ts";

/**
 * The Overview figures per account (#114), the same view the SQLite read model aggregates in SQL:
 * unknown sizes and attachment counts add nothing, only archived === true counts, deletable size
 * follows the latest executed trash/untrash effect per message, and one applied unsubscribe entry
 * is one sender. Log entries arrive oldest first, so a later effect overwrites an earlier one.
 */
export function figuresOver(data: () => Data) {
  return (
    ws: WorkspaceId,
    accountIds: readonly AccountId[],
  ): Result<readonly AccountFigures[], StorageError> => {
    const d = data();
    const wanted = new Set<string>(accountIds);
    const trashed = new Map<string, boolean>();
    const unsubscribed = new Map<string, number>();
    for (const l of d.actionLog.values()) {
      if (l.workspaceId !== ws) continue;
      if (l.outcome !== "applied" && l.outcome !== "undone") continue;
      if (l.command.kind === "trash" || l.command.kind === "untrash")
        for (const id of l.command.messageIds) trashed.set(id, l.command.kind === "trash");
      if (l.outcome === "applied" && l.command.kind === "unsubscribe") {
        const owner = d.actionLogAccount.get(key(ws, l.id));
        if (owner !== undefined && wanted.has(owner))
          unsubscribed.set(owner, (unsubscribed.get(owner) ?? 0) + 1);
      }
    }
    const rows = new Map<string, AccountFigures>();
    for (const m of d.messages.values()) {
      if (m.workspaceId !== ws || !wanted.has(m.accountId)) continue;
      const f = rows.get(m.accountId) ?? {
        accountId: m.accountId,
        archived: 0,
        savedCount: 0,
        savedSize: 0,
        deletableSize: 0,
        unsubscribed: 0,
        totalSize: 0,
      };
      rows.set(m.accountId, {
        ...f,
        archived: f.archived + (m.archived === true ? 1 : 0),
        savedCount: f.savedCount + (m.savedCount ?? 0),
        savedSize: f.savedSize + (m.savedSize ?? 0),
        deletableSize: f.deletableSize + (trashed.get(m.id) === true ? (m.size ?? 0) : 0),
        totalSize: f.totalSize + (m.size ?? 0),
      });
    }
    // Like the SQL: an account without stored mail has no row, even with log entries.
    return ok(
      [...rows.values()].map((f) => ({ ...f, unsubscribed: unsubscribed.get(f.accountId) ?? 0 })),
    );
  };
}

import { accountSchema } from "@pochimail/accounts/model/account";
import type { Database } from "better-sqlite3-multiple-ciphers";
import type { z } from "zod";
import { find, guard, type Row, sqlHelpers } from "../shared/sql.ts";
import { text } from "../shared/values.ts";

/** `granted_scopes` is a JSON array of scope strings; a bad value means "no scopes", never a crash. */
const parseScopes = (raw: unknown): string[] => {
  if (typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
};

const accountOf = (r: Row) =>
  accountSchema.parse({
    schemaVersion: 1,
    id: r.id,
    workspaceId: r.workspace_id,
    provider: r.provider,
    address: r.address,
    connectedAt: r.connected_at,
    grantedScopes: parseScopes(r.granted_scopes),
  });

/** Repository over one connection. */
export function createAccountRepository(db: Database) {
  const { all, one, run, atomic } = sqlHelpers(db);
  /** Every table with an `account_id` column, except those handled on their own. */
  function accountScopedTables(): string[] {
    const names = all(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    ).map((r) => text(r.name));
    return names.filter(
      (name) =>
        name !== "action_log" &&
        all(`PRAGMA table_info("${name}")`).some((c) => c.name === "account_id"),
    );
  }

  // ---- accounts ----
  const accounts = {
    get: (ws: string, id: string) =>
      find("Account", () => {
        const r = one("SELECT * FROM account WHERE workspace_id = ? AND id = ?", ws, id);
        return r === undefined ? undefined : accountOf(r);
      }),
    list: (ws: string) =>
      guard(() =>
        all("SELECT * FROM account WHERE workspace_id = ? ORDER BY id", ws).map(accountOf),
      ),
    save: (a: z.infer<typeof accountSchema>) =>
      guard(() => {
        const v = accountSchema.parse(a);
        run(
          `INSERT INTO account (workspace_id, id, provider, address, connected_at, granted_scopes) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (workspace_id, id) DO UPDATE SET provider = excluded.provider, address = excluded.address, connected_at = excluded.connected_at, granted_scopes = excluded.granted_scopes`,
          v.workspaceId,
          v.id,
          v.provider,
          v.address,
          v.connectedAt,
          JSON.stringify(v.grantedScopes),
        );
      }),
    /**
     * Deletes the account and everything scoped to it, children first. Tables are found by their
     * `account_id` column, so a table added later is purged
     * too: that includes the outbox and job rows that name the account. Action log entries are
     * anonymised instead (kind, outcome, date and counts stay; ids and labels go).
     */
    remove: (ws: string, id: string) =>
      guard(() =>
        atomic(() => {
          run(
            `DELETE FROM signal WHERE workspace_id = ? AND message_id IN
               (SELECT id FROM message WHERE workspace_id = ? AND account_id = ?)`,
            ws,
            ws,
            id,
          );
          for (const table of accountScopedTables())
            run(`DELETE FROM "${table}" WHERE workspace_id = ? AND account_id = ?`, ws, id);
          run("UPDATE removal_guard SET active = 1");
          try {
            run(
              `UPDATE action_log SET command = NULL, inverse = NULL WHERE workspace_id = ? AND account_id = ?`,
              ws,
              id,
            );
          } finally {
            run("UPDATE removal_guard SET active = 0");
          }
          run("DELETE FROM account WHERE workspace_id = ? AND id = ?", ws, id);
        })(),
      ),
  };

  return accounts;
}

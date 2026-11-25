import { type KeepRule, keepRuleSchema } from "@pochimail/cleanup/model/keep-rule";
import type { KeepRuleRepository } from "@pochimail/cleanup/ports/keep-rule-repository";
import type { Database } from "better-sqlite3-multiple-ciphers";
import { guard, sqlHelpers } from "../shared/sql.ts";
import { text } from "../shared/values.ts";

const ruleOf = (r: Record<string, unknown>): KeepRule =>
  keepRuleSchema.parse({
    schemaVersion: 1,
    workspaceId: r.workspace_id,
    accountId: r.account_id,
    senderHash: r.sender_hash,
    ruleType: r.rule_type,
    createdAt: r.created_at,
  });

/** Repository over one connection. The sender is already a keyed hash when it gets here. */
export function createKeepRuleRepository(db: Database): KeepRuleRepository {
  const { all, run } = sqlHelpers(db);
  return {
    list: async (ws, account, senderHash) =>
      guard(() =>
        all(
          `SELECT * FROM keep_rule WHERE workspace_id = ? AND account_id = ? AND sender_hash = ?
           ORDER BY rule_type`,
          ws,
          account,
          senderHash,
        ).map(ruleOf),
      ),
    save: async (rule) =>
      guard(() => {
        const v = keepRuleSchema.parse(rule);
        run(
          `INSERT INTO keep_rule (workspace_id, account_id, sender_hash, rule_type, created_at)
           VALUES (?, ?, ?, ?, ?) ON CONFLICT (workspace_id, account_id, sender_hash, rule_type) DO NOTHING`,
          v.workspaceId,
          v.accountId,
          text(v.senderHash),
          v.ruleType,
          v.createdAt,
        );
      }),
  };
}

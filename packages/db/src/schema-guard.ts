import { StorageError } from "@pochimail/kernel/errors";
import { err, ok, type Result } from "@pochimail/kernel/result";
import type { Database } from "better-sqlite3-multiple-ciphers";
import { z } from "zod";

/** The complete at-rest allow-list (ADR 0014). Add a column here only with an ADR. */
export const ALLOWED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  account: ["workspace_id", "id", "provider", "address", "connected_at", "granted_scopes"],
  action_log: [
    "seq",
    "workspace_id",
    "id",
    "action_id",
    "idempotency_key",
    "batch_id",
    "outcome",
    "account_id",
    "command_kind",
    "message_count",
    "inverse_kind",
    "command",
    "inverse",
    "irreversible",
    "irreversible_reason",
    "error_code",
    "denial_reason",
    "at",
  ],
  cursor: ["workspace_id", "account_id", "scope", "token"],
  derived: [
    "workspace_id",
    "message_id",
    "account_id",
    "category",
    "reason_code",
    "confidence",
    "model_version",
    "derived_at",
  ],
  digest_state: ["workspace_id", "account_id", "last_digest_at", "last_sequence"],
  ingest_counter: ["id", "value"],
  job: [
    "seq",
    "id",
    "workspace_id",
    "type",
    "payload",
    "idempotency_key",
    "state",
    "run_at",
    "run_at_ms",
    "attempts",
    "lease",
    "lease_expires_ms",
    "error_code",
    "finished_ms",
    "account_id",
  ],
  keep_rule: ["workspace_id", "account_id", "sender_hash", "rule_type", "created_at"],
  message: [
    "workspace_id",
    "id",
    "account_id",
    "thread_id",
    "sender_hash",
    "received_at",
    "has_list_unsubscribe",
    "opened",
    "size",
    "saved_count",
    "saved_size",
    "archived",
    "topic_ids",
    "suspicious_reason_code",
    "suspicious_confidence",
    "category",
    "ingest_seq",
  ],
  outbox: ["seq", "kind", "workspace_id", "payload", "created_at", "delivered_at", "account_id"],
  removal_guard: ["id", "active"],
  sender_stats: [
    "workspace_id",
    "account_id",
    "sender_hash",
    "message_count",
    "opened_count",
    "replied_count",
    "last_message_at",
    "vip",
  ],
  signal: ["workspace_id", "message_id", "kind", "confidence", "detected_at", "reason_code"],
  suggestion: [
    "workspace_id",
    "id",
    "account_id",
    "state",
    "confidence",
    "created_at",
    "command",
    "reason_codes",
  ],
  thread: ["workspace_id", "id", "account_id", "message_ids", "last_message_at"],
  topic: ["workspace_id", "id", "data"],
};

const nameRow = z.object({ name: z.string() });
const columnRow = z.object({ name: z.string(), hidden: z.number() });

/**
 * Guards the schema against a column outside ADR 0014, including a column added by a future
 * migration or by a hand-edited database. Virtual tables and FTS5 shadow tables are not allowed.
 */
export function guardSchema(db: Database): Result<void, StorageError> {
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((row) => nameRow.parse(row).name);
    const problems: string[] = [];
    for (const name of tables) {
      const allowed = ALLOWED_COLUMNS[name];
      if (allowed === undefined) {
        problems.push(`unexpected table ${name}`);
        continue;
      }
      const columns = db
        .prepare(`PRAGMA table_xinfo("${name}")`)
        .all()
        .map((row) => columnRow.parse(row))
        .filter((c) => c.hidden === 0)
        .map((c) => c.name);
      for (const column of columns)
        if (!allowed.includes(column)) problems.push(`${name}.${column}`);
    }
    return problems.length === 0
      ? ok(undefined)
      : err(new StorageError(`Columns outside the ADR 0014 allow-list: ${problems.join(", ")}`));
  } catch (cause) {
    return err(new StorageError("Could not read the database schema", { cause }));
  }
}

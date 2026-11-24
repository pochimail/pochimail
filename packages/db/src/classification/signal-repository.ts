import { type StoredSignal, signalSchema } from "@pochimail/classification/model/signal";
import type { Database } from "better-sqlite3-multiple-ciphers";
import { reasonCode } from "../shared/reason-code.ts";
import type { RepositoryContext } from "../shared/repository-context.ts";
import { CHUNK, guard, type Row, sqlHelpers } from "../shared/sql.ts";
import { text } from "../shared/values.ts";

const signalId = (messageId: string, kind: string) => `${messageId}/${kind}`;

const signalOf = (r: Row, context: RepositoryContext): StoredSignal => {
  const ws = text(r.workspace_id);
  const messageId = text(r.message_id);
  const kind = text(r.kind);
  return {
    ...signalSchema.parse({
      schemaVersion: 1,
      workspaceId: ws,
      messageId,
      kind,
      confidence: r.confidence,
      detectedAt: r.detected_at,
    }),
    reason:
      context.cache.ofFields("signal", ws, signalId(messageId, kind)).reason ?? text(r.reason_code),
  };
};

/** Repository over one connection. Signals keep a fixed reason code, never the rule text. */
export function createSignalRepository(db: Database, context: RepositoryContext) {
  const { all, run, atomic } = sqlHelpers(db);
  const replaceSignals = atomic(
    (ws: string, ids: readonly string[], rows: readonly StoredSignal[]) => {
      for (let i = 0; i < ids.length; i += CHUNK)
        run(
          "DELETE FROM signal WHERE workspace_id = ? AND message_id IN (SELECT value FROM json_each(?))",
          ws,
          JSON.stringify(ids.slice(i, i + CHUNK)),
        );
      for (const s of rows) {
        context.cache.rememberFields("signal", ws, signalId(s.messageId, s.kind), {
          reason: s.reason,
        });
        run(
          `INSERT INTO signal (workspace_id, message_id, kind, confidence, detected_at, reason_code)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (workspace_id, message_id, kind) DO UPDATE SET confidence = excluded.confidence,
             detected_at = excluded.detected_at, reason_code = excluded.reason_code`,
          s.workspaceId,
          s.messageId,
          s.kind,
          s.confidence,
          s.detectedAt,
          reasonCode(s.reason),
        );
      }
    },
  );
  return {
    listForMessages: (ws: string, ids: readonly string[]) =>
      guard(() => {
        const out: StoredSignal[] = [];
        for (let i = 0; i < ids.length; i += CHUNK)
          out.push(
            ...all(
              "SELECT * FROM signal WHERE workspace_id = ? AND message_id IN (SELECT value FROM json_each(?))",
              ws,
              JSON.stringify(ids.slice(i, i + CHUNK)),
            ).map((r) => signalOf(r, context)),
          );
        return out.sort(
          (a, b) =>
            (a.messageId < b.messageId ? -1 : a.messageId > b.messageId ? 1 : 0) ||
            (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0),
        );
      }),
    replaceForMessages: (ws: string, ids: readonly string[], rows: readonly StoredSignal[]) =>
      guard(() => replaceSignals(ws, ids, rows)),
  };
}

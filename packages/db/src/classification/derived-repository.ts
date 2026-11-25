import { derivedMessageSchema } from "@pochimail/classification/model/derived";
import type { Database } from "better-sqlite3-multiple-ciphers";
import type { z } from "zod";
import { decodeCursor, page } from "../shared/paging.ts";
import { reasonCode } from "../shared/reason-code.ts";
import type { RepositoryContext } from "../shared/repository-context.ts";
import { find, guard, type Row, sqlHelpers } from "../shared/sql.ts";
import { text } from "../shared/values.ts";

const derivedOf = (r: Row, context: RepositoryContext) => {
  const ws = text(r.workspace_id);
  const id = text(r.message_id);
  const fields = context.cache.ofFields("derived", ws, id);
  return derivedMessageSchema.parse({
    schemaVersion: 1,
    workspaceId: ws,
    accountId: r.account_id,
    messageId: id,
    category: r.category,
    reason: fields.reason ?? text(r.reason_code),
    confidence: r.confidence,
    modelVersion: r.model_version,
    ...(fields.templateHash === undefined ? {} : { templateHash: fields.templateHash }),
    ...(fields.embeddingRef === undefined ? {} : { embeddingRef: fields.embeddingRef }),
    snippet: fields.snippet ?? "",
    derivedAt: r.derived_at,
  });
};

/** Repository over one connection. Only the reason code is persisted (ADR 0014). */
export function createDerivedRepository(db: Database, context: RepositoryContext) {
  const { all, one, run } = sqlHelpers(db);
  const derived = {
    get: (ws: string, id: string) =>
      find("Derived data", () => {
        const r = one("SELECT * FROM derived WHERE workspace_id = ? AND message_id = ?", ws, id);
        return r === undefined ? undefined : derivedOf(r, context);
      }),
    list: (ws: string, account: string, p: { limit: number; cursor?: string }) =>
      guard(() => {
        const after = p.cursor === undefined ? undefined : decodeCursor(p.cursor, 1)[0];
        const limit = Math.max(1, Math.floor(p.limit));
        const rows = all(
          `SELECT * FROM derived WHERE workspace_id = ? AND account_id = ?
             ${after === undefined ? "" : "AND message_id > ?"} ORDER BY message_id LIMIT ?`,
          ws,
          account,
          ...(after === undefined ? [] : [after]),
          limit + 1,
        );
        return page(
          rows,
          limit,
          (r) => derivedOf(r, context),
          (r) => [text(r.message_id)],
        );
      }),
    save: (d: z.infer<typeof derivedMessageSchema>) =>
      guard(() => {
        const v = derivedMessageSchema.parse(d);
        context.cache.rememberFields("derived", v.workspaceId, v.messageId, {
          reason: v.reason,
          snippet: v.snippet,
          ...(v.templateHash === undefined ? {} : { templateHash: v.templateHash }),
          ...(v.embeddingRef === undefined ? {} : { embeddingRef: v.embeddingRef }),
        });
        run(
          `INSERT INTO derived (workspace_id, message_id, account_id, category, reason_code, confidence, model_version, derived_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (workspace_id, message_id) DO UPDATE SET account_id = excluded.account_id,
             category = excluded.category, reason_code = excluded.reason_code,
             confidence = excluded.confidence, model_version = excluded.model_version,
             derived_at = excluded.derived_at`,
          v.workspaceId,
          v.messageId,
          v.accountId,
          v.category,
          reasonCode(v.reason),
          v.confidence,
          v.modelVersion,
          v.derivedAt,
        );
      }),
  };

  return derived;
}

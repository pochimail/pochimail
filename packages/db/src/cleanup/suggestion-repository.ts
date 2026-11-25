import { recommendationSchema, suggestionSchema } from "@pochimail/cleanup/model/suggestion";
import type { Database } from "better-sqlite3-multiple-ciphers";
import { z } from "zod";
import { decodeCursor, page } from "../shared/paging.ts";
import { reasonCode } from "../shared/reason-code.ts";
import type { RepositoryContext } from "../shared/repository-context.ts";
import { find, guard, type Row, sqlHelpers } from "../shared/sql.ts";
import { json, text } from "../shared/values.ts";

const reasonCodes = (raw: unknown) => z.array(z.string()).parse(json(raw));

const suggestionOf = (r: Row, context: RepositoryContext) => {
  const ws = text(r.workspace_id);
  const id = text(r.id);
  const fields = context.cache.ofFields("suggestion", ws, id);
  return suggestionSchema.parse({
    schemaVersion: 1,
    id,
    workspaceId: ws,
    accountId: r.account_id,
    recommendation: recommendationSchema.parse(fields.recommendation ?? json(r.command)),
    reasons: fields.reasons ?? reasonCodes(r.reason_codes),
    confidence: r.confidence,
    state: r.state,
    createdAt: r.created_at,
  });
};

/** Repository over one connection. Reasons become codes and commands hold ids/kinds only. */
export function createSuggestionRepository(db: Database, context: RepositoryContext) {
  const { all, one, run } = sqlHelpers(db);
  const suggestions = {
    get: (ws: string, id: string) =>
      find("Suggestion", () => {
        const r = one("SELECT * FROM suggestion WHERE workspace_id = ? AND id = ?", ws, id);
        return r === undefined ? undefined : suggestionOf(r, context);
      }),
    listPending: (ws: string, p: { limit: number; cursor?: string }) =>
      guard(() => {
        const after = p.cursor === undefined ? undefined : decodeCursor(p.cursor, 2);
        const limit = Math.max(1, Math.floor(p.limit));
        const rows = all(
          `SELECT * FROM suggestion WHERE workspace_id = ? AND state = 'pending'
             ${after === undefined ? "" : "AND (created_at > ? OR (created_at = ? AND id > ?))"}
           ORDER BY created_at, id LIMIT ?`,
          ws,
          ...(after === undefined ? [] : [after[0], after[0], after[1]]),
          limit + 1,
        );
        return page(
          rows,
          limit,
          (r) => suggestionOf(r, context),
          (r) => [text(r.created_at), text(r.id)],
        );
      }),
    save: (s: z.infer<typeof suggestionSchema>) =>
      guard(() => {
        const v = suggestionSchema.parse(s);
        context.cache.rememberFields("suggestion", v.workspaceId, v.id, {
          reasons: v.reasons,
          recommendation: v.recommendation,
        });
        const command = recommendationSchema.parse({
          kind: v.recommendation.kind,
          messageIds: v.recommendation.messageIds,
        });
        run(
          `INSERT INTO suggestion (workspace_id, id, account_id, state, confidence, created_at, command, reason_codes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (workspace_id, id) DO UPDATE SET account_id = excluded.account_id, state = excluded.state,
             confidence = excluded.confidence, created_at = excluded.created_at,
             command = excluded.command, reason_codes = excluded.reason_codes`,
          v.workspaceId,
          v.id,
          v.accountId,
          v.state,
          v.confidence,
          v.createdAt,
          JSON.stringify(command),
          JSON.stringify(v.reasons.map(reasonCode)),
        );
      }),
  };

  return suggestions;
}

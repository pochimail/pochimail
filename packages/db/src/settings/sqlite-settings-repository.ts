import type { AsyncResult } from "@pochimail/kernel/common";
import type { StorageError } from "@pochimail/kernel/errors";
import type { WorkspaceId } from "@pochimail/kernel/ids";
import { z } from "zod";
import { exclusiveResult, type Storage } from "../open-storage.ts";
import { guard, sqlHelpers } from "../shared/sql.ts";

const settingsRow = z.object({ data: z.string() });

export interface SettingsRepository {
  /** The stored document, or null when the workspace never saved. The caller owns its shape. */
  get(workspaceId: WorkspaceId): AsyncResult<unknown, StorageError>;
  /** Replaces the workspace's document. */
  save(workspaceId: WorkspaceId, document: unknown): AsyncResult<void, StorageError>;
}

/** Settings documents on the writer connection, one statement at a time through `storage.exclusive`. */
export function createSqliteSettingsRepository(storage: Storage): SettingsRepository {
  const { one, run } = sqlHelpers(storage.writer);
  return {
    get: (workspaceId) =>
      exclusiveResult(storage, async () =>
        guard((): unknown => {
          const row = one("SELECT data FROM settings WHERE workspace_id = ?", workspaceId);
          return row === undefined ? null : JSON.parse(settingsRow.parse(row).data);
        }),
      ),
    save: (workspaceId, document) =>
      exclusiveResult(storage, async () =>
        guard(() => {
          run(
            `INSERT INTO settings (workspace_id, data) VALUES (?, ?)
             ON CONFLICT (workspace_id) DO UPDATE SET data = excluded.data`,
            workspaceId,
            JSON.stringify(document),
          );
        }),
      ),
  };
}

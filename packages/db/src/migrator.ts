import { StorageError } from "@pochimail/kernel/errors";
import { err, ok, type Result } from "@pochimail/kernel/result";
import type { Database } from "better-sqlite3-multiple-ciphers";
import coreSql from "./migrations/0001_core.sql?raw";
import mailSql from "./migrations/0002_mail_repositories.sql?raw";
import scopesSql from "./migrations/0003_account_granted_scopes.sql?raw";
import sizeSql from "./migrations/0004_message_size.sql?raw";
import figuresSql from "./migrations/0005_overview_figures.sql?raw";
import reportsSql from "./migrations/0006_reports_only.sql?raw";

export interface Migration {
  /** 1, 2, 3…: the value `PRAGMA user_version` holds once it has run. */
  readonly version: number;
  readonly sql: string;
}

/** The reports-only migration drops clear-text columns; its freed pages and WAL frames need scrubbing (ADR 0014). */
const REPORTS_ONLY_VERSION = 6;

/**
 * The SQL files are imported into the bundle: the worker runs from a built file with no `migrations/` next to it,
 * so reading them from disk at runtime would make every database open fail there (ADR 0005).
 */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, sql: coreSql },
  { version: 2, sql: mailSql },
  { version: 3, sql: scopesSql },
  { version: 4, sql: sizeSql },
  { version: 5, sql: figuresSql },
  { version: 6, sql: reportsSql },
];

/**
 * Brings the database to the newest version. Each migration runs in its own transaction and bumps
 * `user_version` with it, so a crash leaves the previous version intact; running it again does
 * nothing. A database written by a newer build is refused rather than guessed at.
 */
export function migrate(
  db: Database,
  migrations: readonly Migration[] = MIGRATIONS,
): Result<{ from: number; to: number }, StorageError> {
  const latest = migrations.at(-1)?.version ?? 0;
  try {
    const from = Number(db.pragma("user_version", { simple: true }));
    if (from > latest) {
      return err(
        new StorageError(`Database version ${from} is newer than this app supports (${latest})`),
      );
    }
    const pending = migrations.filter((x) => x.version > from);
    for (const m of pending) {
      db.transaction(() => {
        db.exec(m.sql);
        db.pragma(`user_version = ${m.version}`);
      })();
    }
    if (pending.some((m) => m.version === REPORTS_ONLY_VERSION)) {
      // Outside the transaction: VACUUM cannot run inside one. This also truncates the WAL frames
      // that still held the pre-v6 rows, so no clear-text subject or address survives on disk.
      db.pragma("secure_delete = ON");
      db.exec("VACUUM");
      db.pragma("wal_checkpoint(TRUNCATE)");
    }
    return ok({ from, to: latest });
  } catch (cause) {
    return err(new StorageError("Database migration failed", { cause }));
  }
}

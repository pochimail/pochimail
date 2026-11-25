import { StorageError } from "@pochimail/kernel/errors";
import { err, ok, type Result } from "@pochimail/kernel/result";
import type { Database } from "better-sqlite3-multiple-ciphers";
import coreSql from "./migrations/0001_core.sql?raw";
import mailSql from "./migrations/0002_mail_repositories.sql?raw";
import scopesSql from "./migrations/0003_account_granted_scopes.sql?raw";
import sizeSql from "./migrations/0004_message_size.sql?raw";
import figuresSql from "./migrations/0005_overview_figures.sql?raw";
import reportsSql from "./migrations/0006_reports_only.sql?raw";
import settingsSql from "./migrations/0007_settings.sql?raw";
import typesSql from "./migrations/0008_email_types.sql?raw";

export interface Migration {
  /** 1, 2, 3…: the value `PRAGMA user_version` holds once it has run. */
  readonly version: number;
  readonly sql: string;
  /** The migration drops clear-text data: the freed pages and WAL frames must be scrubbed too (ADR 0014). */
  readonly scrub?: true;
}

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
  { version: 6, sql: reportsSql, scrub: true },
  { version: 7, sql: settingsSql },
  { version: 8, sql: typesSql },
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
  let from: number;
  try {
    from = Number(db.pragma("user_version", { simple: true }));
    if (from > latest) {
      return err(
        new StorageError(`Database version ${from} is newer than this app supports (${latest})`),
      );
    }
    for (const m of migrations.filter((x) => x.version > from)) {
      db.transaction(() => {
        db.exec(m.sql);
        db.pragma(`user_version = ${m.version}`);
      })();
    }
  } catch (cause) {
    return err(new StorageError("Database migration failed", { cause }));
  }
  try {
    scrubFreedData(db, migrations);
  } catch (cause) {
    return err(new StorageError("Database cleanup after migration failed", { cause }));
  }
  return ok({ from, to: latest });
}

/**
 * Runs on every open until it has succeeded once for the newest `scrub` migration, so a crash or
 * failure after that migration committed is retried instead of leaving clear-text on disk. The
 * marker is `application_id` (a header integer nothing else here uses), set only after success.
 * VACUUM cannot run inside a transaction; the TRUNCATE checkpoint drops the WAL frames that
 * still hold the pre-migration rows.
 */
function scrubFreedData(db: Database, migrations: readonly Migration[]): void {
  const target = migrations.filter((m) => m.scrub).at(-1)?.version ?? 0;
  if (target === 0 || Number(db.pragma("application_id", { simple: true })) >= target) return;
  db.pragma("secure_delete = ON");
  db.exec("VACUUM");
  const [checkpoint] = db.pragma("wal_checkpoint(TRUNCATE)") as { busy: number }[];
  if (checkpoint?.busy) throw new Error("The WAL could not be truncated");
  db.pragma(`application_id = ${target}`);
}

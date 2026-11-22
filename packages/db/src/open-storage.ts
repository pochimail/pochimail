import { AsyncLocalStorage } from "node:async_hooks";
import { closeSync, openSync, readSync } from "node:fs";
import { StorageError } from "@pochimail/kernel/errors";
import { err, ok, type Result } from "@pochimail/kernel/result";
import Database from "better-sqlite3-multiple-ciphers";
import { migrate } from "./migrator.ts";

/**
 * One encrypted database file: a single writer connection and a read-only one (ADR 0005).
 * Readers see only committed data; every write, and every statement that must not interleave with
 * a transaction, goes through `exclusive`.
 */
export interface Storage {
  readonly writer: Database.Database;
  readonly reader: Database.Database;
  /** Runs `fn` after every earlier exclusive call settled. Do not call it from inside `fn`. */
  exclusive<T>(fn: () => Promise<T> | T): Promise<T>;
  /** True while running inside `exclusive` (a transaction or queue statement). */
  inExclusive(): boolean;
  close(): void;
}

/**
 * Like `exclusive`, but answers `Err(StorageError)` instead of hanging when called from inside an
 * exclusive section (for example the job queue or a nested `UnitOfWork.run` inside `run`'s work).
 */
export function exclusiveResult<T, E>(
  storage: Storage,
  fn: () => Promise<Result<T, E>>,
): Promise<Result<T, E | StorageError>> {
  if (storage.inExclusive()) {
    return Promise.resolve(
      err(
        new StorageError(
          "Storage was called from inside a UnitOfWork transaction; use the transaction instead",
        ),
      ),
    );
  }
  return storage.exclusive(fn);
}

const CACHE_KIB = 32 * 1024;
const MMAP_BYTES = 256 * 1024 * 1024;

function connect(path: string, key: Uint8Array, readonly: boolean): Database.Database {
  const db = new Database(path, { readonly });
  try {
    // The cipher must be chosen before the raw key (no KDF: the key is already 256 random bits).
    db.pragma("cipher='sqlcipher'");
    db.pragma(`key="x'${Buffer.from(key).toString("hex")}'"`);
    // Reading the schema is what proves the key: a wrong key fails here, not at `key`.
    db.prepare("SELECT count(*) FROM sqlite_master").get();
    db.pragma("foreign_keys = ON");
    db.pragma(`cache_size = -${CACHE_KIB}`);
    db.pragma(`mmap_size = ${MMAP_BYTES}`);
    db.pragma("busy_timeout = 5000");
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/**
 * Opens (creating if needed) the encrypted WAL database at `path` with a raw 256-bit `key`, then
 * migrates it. Wrong key, unreadable file or a newer database all come back as `StorageError`;
 * the message never carries the key or any path content beyond the failure kind.
 */
export function openStorage(path: string, key: Uint8Array): Result<Storage, StorageError> {
  if (key.length !== 32) return err(new StorageError("The database key must be 32 bytes"));
  let writer: Database.Database | undefined;
  let reader: Database.Database | undefined;
  try {
    writer = connect(path, key, false);
    writer.pragma("journal_mode = wal");
    writer.pragma("synchronous = normal");
    const migrated = migrate(writer);
    if (!migrated.ok) {
      writer.close();
      return migrated;
    }
    reader = connect(path, key, true);
  } catch (cause) {
    writer?.close();
    reader?.close();
    return err(
      new StorageError("Could not open the database (wrong key or damaged file)", { cause }),
    );
  }
  const [w, r] = [writer, reader];
  let tail: Promise<unknown> = Promise.resolve();
  const inside = new AsyncLocalStorage<true>();
  return ok({
    writer: w,
    reader: r,
    exclusive<T>(fn: () => Promise<T> | T): Promise<T> {
      const run = () => inside.run(true, fn);
      const next = tail.then(run, run);
      tail = next.catch(() => undefined);
      return next;
    },
    inExclusive: () => inside.getStore() === true,
    close() {
      r.close();
      w.close();
    },
  });
}

/** True when the file starts with the plain "SQLite format 3" header, i.e. it is not encrypted. */
export function isPlainSqliteFile(path: string): boolean {
  const fd = openSync(path, "r");
  try {
    const header = Buffer.alloc(16);
    readSync(fd, header, 0, 16, 0);
    return header.toString("latin1").startsWith("SQLite format 3");
  } finally {
    closeSync(fd);
  }
}

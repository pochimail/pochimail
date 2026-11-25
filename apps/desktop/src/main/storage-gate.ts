import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { err, ok, type Result } from "@pochimail/kernel/result";
import type { Logger } from "@pochimail/logger/logger";
import {
  passphraseSchema,
  type StorageOutcome,
  type StorageStatus,
  unlockPassphraseSchema,
} from "../shared/storage-calls.ts";
import {
  createUnprotectedKey,
  readStorageChoice,
  readUnprotectedKey,
  writeStorageChoice,
} from "./storage-choice.ts";
import {
  DatabaseKeyError,
  type KeyVault,
  keyProtection,
  loadOrCreateDatabaseKey,
} from "./storage-key.ts";
import {
  createPassphraseChoice,
  keyForPassphrase,
  type PassphraseChoice,
} from "./storage-passphrase.ts";

type DatabaseKey = Result<Buffer | undefined, DatabaseKeyError>;
type State =
  | { kind: "choose" }
  | { kind: "locked"; choice: PassphraseChoice }
  | { kind: "settled"; key: DatabaseKey; passphrase?: true };

export type StorageGateOptions = {
  vault: KeyVault;
  platform: NodeJS.Platform;
  /** Electron's per-user userData directory: the only place the choice and the key files live. */
  directory: string;
  databaseFile: string;
  logger: Logger;
};

/**
 * Decides how the database key is obtained and holds the one prompt that may precede it (ADR 0005). On basic-text no key
 * exists until the person chooses; a passphrase-derived key lives only in this process' memory; os-keychain never asks.
 * The renderer can only answer a question that is open: once the key is settled every call refuses.
 */
export const createStorageGate = (options: StorageGateOptions) => {
  const { vault, platform, databaseFile, logger } = options;
  const choiceFile = join(options.directory, "storage-protection.json");
  const keychainKeyFile = join(options.directory, "db.key");
  const plainKeyFile = join(options.directory, "db.key.plain");

  const decide = async (): Promise<State> => {
    const choice = readStorageChoice(choiceFile);
    if (!choice.ok) return { kind: "settled", key: choice };
    if (choice.value?.mode === "unprotected")
      return { kind: "settled", key: readUnprotectedKey(plainKeyFile) };
    if (choice.value?.mode === "passphrase") return { kind: "locked", choice: choice.value };
    if ((await keyProtection(vault, platform)).level === "basic-text")
      return existsSync(databaseFile)
        ? // A key is never minted over an existing database: that would orphan its data.
          { kind: "settled", key: err(new DatabaseKeyError("key-missing-database-exists")) }
        : { kind: "choose" };
    return {
      kind: "settled",
      key: await loadOrCreateDatabaseKey(vault, keychainKeyFile, platform, databaseFile),
    };
  };

  let state: State | undefined;
  let busy = false;
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const started = decide()
    .catch((): State => ({ kind: "settled", key: err(new DatabaseKeyError("key-file-invalid")) }))
    .then((next) => {
      state = next;
      if (next.kind === "settled") release();
    });
  const settle = (key: Buffer, passphrase?: true): void => {
    state = { kind: "settled", key: ok(key), ...(passphrase ? { passphrase } : {}) };
    release();
  };

  /** Runs one answer to the open question, one at a time; a failure is logged by a fixed message only. */
  const answer = async (
    question: State["kind"],
    run: (current: State) => Promise<StorageOutcome>,
  ): Promise<StorageOutcome> => {
    await started;
    if (state?.kind !== question || busy) return "failed";
    busy = true;
    try {
      return await run(state);
    } catch {
      logger.error("storage protection could not be saved", {
        operation: "start",
        code: "storage.failed",
      });
      return "failed";
    } finally {
      busy = false;
    }
  };

  return {
    status: async (): Promise<StorageStatus> => {
      await started;
      if (state?.kind === "choose" || state?.kind === "locked") return state.kind;
      return state?.kind === "settled" && !state.key.ok ? "blocked" : "ready";
    },

    /** A copy of the key for one worker start (the caller zeroes it), or the reason there is none. Waits for the choice. */
    key: async (): Promise<DatabaseKey> => {
      await released;
      const key =
        state?.kind === "settled" ? state.key : err(new DatabaseKeyError("key-file-invalid"));
      return key.ok && key.value !== undefined ? ok(Buffer.from(key.value)) : key;
    },

    /**
     * A copy of the database key when the person chose a passphrase, else `undefined`: only then may tokens persist on
     * basic-text (#247). Waits for the choice; the caller zeroes it.
     */
    passphraseKey: async (): Promise<Buffer | undefined> => {
      await released;
      return state?.kind === "settled" && state.passphrase && state.key.ok && state.key.value
        ? Buffer.from(state.key.value)
        : undefined;
    },

    setPassphrase: (raw: unknown): Promise<StorageOutcome> =>
      answer("choose", async () => {
        const passphrase = passphraseSchema.safeParse(raw);
        if (!passphrase.success) return "failed";
        const { choice, key } = await createPassphraseChoice(passphrase.data);
        try {
          writeStorageChoice(choiceFile, choice);
        } catch (error) {
          key.fill(0);
          throw error;
        }
        rmSync(plainKeyFile, { force: true });
        settle(key, true);
        logger.info("storage protected with a passphrase", { operation: "start" });
        return "ready";
      }),

    storeUnprotected: (): Promise<StorageOutcome> =>
      answer("choose", async () => {
        const key = createUnprotectedKey(plainKeyFile);
        try {
          writeStorageChoice(choiceFile, { mode: "unprotected" });
        } catch (error) {
          key.fill(0);
          throw error;
        }
        settle(key);
        logger.info("storage kept without protection by choice", { operation: "start" });
        return "ready";
      }),

    unlock: (raw: unknown): Promise<StorageOutcome> =>
      answer("locked", async (current) => {
        const passphrase = unlockPassphraseSchema.safeParse(raw);
        if (current.kind !== "locked" || !passphrase.success) return "wrong-passphrase";
        const key = await keyForPassphrase(passphrase.data, current.choice);
        if (key === undefined) {
          logger.warn("storage unlock refused, wrong passphrase", { operation: "start" });
          return "wrong-passphrase";
        }
        settle(key, true);
        return "ready";
      }),

    /** Zeroes the key held for later windows; called when the app quits. */
    dispose: (): void => {
      if (state?.kind === "settled" && state.key.ok) state.key.value?.fill(0);
    },
  };
};

export type StorageGate = ReturnType<typeof createStorageGate>;

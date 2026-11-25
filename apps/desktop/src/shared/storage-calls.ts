import { z } from "zod";

/**
 * The storage-protection prompt (ADR 0005) runs before the worker exists, so it cannot use the worker's typed contract:
 * these four calls go through main, like the OS calls. None of them ever returns a key or a passphrase.
 */
export const storageChannels = {
  status: "storage:status",
  setPassphrase: "storage:set-passphrase",
  storeUnprotected: "storage:store-unprotected",
  unlock: "storage:unlock",
} as const;

export const PASSPHRASE_MIN_LENGTH = 8;
export const PASSPHRASE_MAX_LENGTH = 256;

export const passphraseSchema = z.string().min(PASSPHRASE_MIN_LENGTH).max(PASSPHRASE_MAX_LENGTH);

/** `choose`: basic-text and no choice yet. `locked`: a passphrase is set and not entered. `ready`: nothing to ask. */
export const storageStatusSchema = z.enum(["ready", "choose", "locked"]);
export type StorageStatus = z.infer<typeof storageStatusSchema>;

/** What a choice or an unlock answered. A wrong passphrase is the only outcome the person can fix by trying again. */
export const storageOutcomeSchema = z.enum(["ready", "wrong-passphrase", "failed"]);
export type StorageOutcome = z.infer<typeof storageOutcomeSchema>;

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { err, ok, type Result } from "@pochimail/kernel/result";
import { z } from "zod";
import { writeFileAtomic } from "./atomic-write.ts";
import { DatabaseKeyError } from "./storage-key.ts";
import { passphraseChoiceSchema } from "./storage-passphrase.ts";

/** What the person chose on basic-text: a passphrase (parameters and salt only) or, as a second explicit choice, nothing. */
const storageChoiceSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("unprotected") }),
  passphraseChoiceSchema,
]);
export type StorageChoice = z.infer<typeof storageChoiceSchema>;

const KEY_HEX = /^[0-9a-f]{64}$/i;

/** `ok(undefined)` means no choice yet. A file that exists but is unreadable is an error: never ask again over it. */
export const readStorageChoice = (
  file: string,
): Result<StorageChoice | undefined, DatabaseKeyError> => {
  if (!existsSync(file)) return ok(undefined);
  try {
    return ok(storageChoiceSchema.parse(JSON.parse(readFileSync(file, "utf8"))));
  } catch {
    return err(new DatabaseKeyError("choice-file-invalid"));
  }
};

export const writeStorageChoice = (file: string, choice: StorageChoice): void =>
  writeFileAtomic(file, JSON.stringify(choice));

/** The key of the "store without protection" choice: random, in a private file, readable by anyone with the files. */
export const createUnprotectedKey = (file: string): Buffer => {
  const key = randomBytes(32);
  writeFileAtomic(file, key.toString("hex"));
  return key;
};

export const readUnprotectedKey = (file: string): Result<Buffer, DatabaseKeyError> => {
  try {
    const hex = readFileSync(file, "utf8");
    return KEY_HEX.test(hex)
      ? ok(Buffer.from(hex, "hex"))
      : err(new DatabaseKeyError("key-file-invalid"));
  } catch {
    return err(new DatabaseKeyError("key-file-invalid"));
  }
};

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const PREFIX = "pp1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** A stored entry sealed by `seal` rather than wrapped by the OS keychain. */
export const isSealed = (stored: string): boolean => stored.startsWith(PREFIX);

/** A subkey for tokens: the database key itself never encrypts anything but the database. The caller zeroes the result. */
const secretKeyFrom = (databaseKey: Buffer): Buffer =>
  Buffer.from(hkdfSync("sha256", databaseKey, Buffer.alloc(0), "pochimail/secret-vault/v1", 32));

/**
 * AES-256-GCM under a subkey of the passphrase-derived key, for Linux `basic_text` where the OS wrap is only obfuscation.
 * The entry name is authenticated, so a sealed value cannot be moved to another name.
 */
export const seal = (databaseKey: Buffer, name: string, value: string): string => {
  const key = secretKeyFrom(databaseKey);
  try {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(name, "utf8"));
    const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
  } finally {
    key.fill(0);
  }
};

/** Throws when the key is wrong or the entry was altered. */
export const unseal = (databaseKey: Buffer, name: string, stored: string): string => {
  const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
  const key = secretKeyFrom(databaseKey);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, IV_BYTES));
    decipher.setAAD(Buffer.from(name, "utf8"));
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    return Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString("utf8");
  } finally {
    key.fill(0);
  }
};

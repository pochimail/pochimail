import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const hex = (bytes: number) => z.string().regex(new RegExp(`^[0-9a-f]{${bytes * 2}}$`));
const isPowerOfTwo = (n: number) => (n & (n - 1)) === 0;

/** What the flag file records about a passphrase: parameters, a random salt and a verifier. Never the key. */
export const passphraseChoiceSchema = z.object({
  mode: z.literal("passphrase"),
  kdf: z.object({
    name: z.literal("scrypt"),
    N: z
      .number()
      .int()
      .min(2 ** 15)
      .max(2 ** 20)
      .refine(isPowerOfTwo),
    r: z.literal(8),
    p: z.literal(1),
  }),
  salt: hex(16),
  verifier: hex(32),
});
export type PassphraseChoice = z.infer<typeof passphraseChoiceSchema>;

const NEW_KDF = { name: "scrypt", N: 2 ** 17, r: 8, p: 1 } as const;
const KEY_BYTES = 32;

/** One scrypt run gives 64 bytes: the first half is the database key, the second half only proves the passphrase. */
const derive = async (
  passphrase: string,
  salt: Buffer,
  { N, r, p }: PassphraseChoice["kdf"],
): Promise<{ key: Buffer; verifier: Buffer }> => {
  const secret = Buffer.from(passphrase.normalize("NFKC"), "utf8");
  try {
    const out = await new Promise<Buffer>((resolve, reject) =>
      scrypt(secret, salt, KEY_BYTES * 2, { N, r, p, maxmem: 256 * N * r }, (error, derived) =>
        error === null ? resolve(derived) : reject(error),
      ),
    );
    const key = Buffer.from(out.subarray(0, KEY_BYTES));
    const verifier = Buffer.from(out.subarray(KEY_BYTES));
    out.fill(0);
    return { key, verifier };
  } finally {
    secret.fill(0);
  }
};

/** A fresh salt, the key it yields and the record to persist. The caller zeroes `key` after use. */
export const createPassphraseChoice = async (
  passphrase: string,
): Promise<{ choice: PassphraseChoice; key: Buffer }> => {
  const salt = randomBytes(16);
  const { key, verifier } = await derive(passphrase, salt, NEW_KDF);
  const choice = {
    mode: "passphrase" as const,
    kdf: NEW_KDF,
    salt: salt.toString("hex"),
    verifier: verifier.toString("hex"),
  };
  verifier.fill(0);
  return { choice, key };
};

/** The database key for this passphrase, or `undefined` when it is wrong. The caller zeroes the key after use. */
export const keyForPassphrase = async (
  passphrase: string,
  choice: PassphraseChoice,
): Promise<Buffer | undefined> => {
  const { key, verifier } = await derive(passphrase, Buffer.from(choice.salt, "hex"), choice.kdf);
  const matches = timingSafeEqual(verifier, Buffer.from(choice.verifier, "hex"));
  verifier.fill(0);
  if (matches) return key;
  key.fill(0);
  return undefined;
};

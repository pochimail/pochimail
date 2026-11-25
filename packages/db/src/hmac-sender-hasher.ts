import { createHmac } from "node:crypto";
import type { SenderHasher } from "@pochimail/mailbox/ports/sender-hasher";

/** Domain separation: the DB key is never used directly to hash an address (ADR 0014). */
const KEY_DOMAIN = "pochimail:db:sender-hash:v1";

/**
 * A keyed sender digest for the account, derived from the database key. The key is held only by the
 * returned closure: it is not stored on `Storage`, in a row or in a log. The same pair always gives
 * the same 64-character hex digest; a different key or account gives a different one.
 */
export function createSenderHasher(key: Uint8Array): SenderHasher {
  if (key.length !== 32) throw new Error("The sender hash key must be 32 bytes");
  const derived = createHmac("sha256", key).update(KEY_DOMAIN).digest();
  return {
    hash(accountId: string, address: string): string {
      return createHmac("sha256", derived)
        .update(accountId)
        .update("\u0000")
        .update(address)
        .digest("hex");
    },
  };
}

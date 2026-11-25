/**
 * A keyed, deterministic sender digest (HMAC). The key never leaves the OS keychain and is never
 * stored with the data; the same sender and account always produce the same hash, whatever the
 * case of the address (ADR 0014).
 */
export interface SenderHasher {
  hash(accountId: string, address: string): string;
}

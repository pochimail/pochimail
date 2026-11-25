/**
 * A deterministic stand-in for the keyed sender digest, for in-memory adapters and fixtures. It
 * lowercases like the real hasher and never contains the address, so a key built from it proves
 * nothing leaks (ADR 0014). It is not a security primitive.
 */
export function fakeSenderHash(accountId: string, address: string): string {
  const input = `${accountId}\u0000${address.toLowerCase()}`;
  let out = "";
  for (let round = 0; round < 4; round++) {
    let h1 = 0xdeadbeef ^ round;
    let h2 = 0x41c6ce57 ^ round;
    for (let i = 0; i < input.length; i++) {
      const c = input.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    out += (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
  }
  return out;
}

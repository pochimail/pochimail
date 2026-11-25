import type { KeyVault } from "../main/storage-key.ts";

/** Reversible stand-in for the OS keychain: the "ciphertext" visibly differs from the plaintext. */
export const fakeVault = (overrides: Partial<KeyVault> = {}): KeyVault => ({
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async (plain) => Buffer.from(`wrapped:${plain}`),
  decryptStringAsync: async (cipher) => ({
    result: cipher.toString().replace("wrapped:", ""),
    shouldReEncrypt: false,
  }),
  ...overrides,
});

/** Linux with no secret service: the real app must ask before storing anything. */
export const basicTextVault = (): KeyVault =>
  fakeVault({ getSelectedStorageBackend: () => "basic_text" });

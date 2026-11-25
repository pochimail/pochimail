import { storageChannels } from "../shared/storage-calls.ts";
import { type IpcHandle, onlyFromAppPage } from "./ipc-guard.ts";
import type { StorageGate } from "./storage-gate.ts";

export type StorageCallDeps = {
  ipc: { handle: IpcHandle };
  gate: StorageGate;
  isAppUrl: (url: string) => boolean;
};

/**
 * The prompt's four calls to main (ADR 0005). Arguments are validated again inside the gate; answers are a status or an
 * outcome word, never key material. Calls from any frame that is not the app's own page are refused.
 */
export const registerStorageCalls = ({ ipc, gate, isAppUrl }: StorageCallDeps): void => {
  const guarded = onlyFromAppPage(isAppUrl);
  ipc.handle(
    storageChannels.status,
    guarded(() => gate.status()),
  );
  ipc.handle(
    storageChannels.setPassphrase,
    guarded((passphrase) => gate.setPassphrase(passphrase)),
  );
  ipc.handle(
    storageChannels.storeUnprotected,
    guarded(() => gate.storeUnprotected()),
  );
  ipc.handle(
    storageChannels.unlock,
    guarded((passphrase) => gate.unlock(passphrase)),
  );
};

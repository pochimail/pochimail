import { contextBridge, ipcRenderer } from "electron";
import {
  chosenFolderSchema,
  folderPathSchema,
  mailAppLinkSchema,
  osChannels,
} from "../shared/os-calls.ts";
import {
  passphraseSchema,
  storageChannels,
  storageOutcomeSchema,
  storageStatusSchema,
  unlockPassphraseSchema,
} from "../shared/storage-calls.ts";
import {
  announcementSchema,
  autoCheckSchema,
  checkResultSchema,
  updateChannels,
  updateStateSchema,
  versionSchema,
} from "../shared/update-calls.ts";

/**
 * Narrow bridge (ADR 0002). Main sends one MessagePort connected to the worker; the page asks for it and the preload
 * forwards it with `window.postMessage`, so the page then talks to the worker directly. The page never gets
 * `ipcRenderer`, `electron` or Node: only these methods, each validated before it leaves the page.
 */
let port: MessagePort | undefined;
let requested = false;

const deliver = (): void => {
  if (port === undefined || !requested) return;
  window.postMessage("pochimail:worker-port", "*", [port]);
  port = undefined;
};

ipcRenderer.once("worker-port", (event) => {
  port = event.ports[0];
  deliver();
});

const api = {
  requestWorkerPort: (): void => {
    requested = true;
    deliver();
  },
  openMailAppLink: (link: string): Promise<void> =>
    ipcRenderer.invoke(osChannels.openMailAppLink, mailAppLinkSchema.parse(link)),
  showInFinder: (path: string): Promise<void> =>
    ipcRenderer.invoke(osChannels.showInFinder, folderPathSchema.parse(path)),
  chooseFolder: async (): Promise<string | null> =>
    chosenFolderSchema.parse(await ipcRenderer.invoke(osChannels.chooseFolder)),
  updates: {
    state: async () => updateStateSchema.parse(await ipcRenderer.invoke(updateChannels.state)),
    checkNow: async () =>
      checkResultSchema.parse(await ipcRenderer.invoke(updateChannels.checkNow)),
    setAutoCheck: (enabled: boolean): Promise<void> =>
      ipcRenderer.invoke(updateChannels.setAutoCheck, autoCheckSchema.parse(enabled)),
    dismiss: (version: string): Promise<void> =>
      ipcRenderer.invoke(updateChannels.dismiss, versionSchema.parse(version)),
    download: (): Promise<void> => ipcRenderer.invoke(updateChannels.download),
    announcement: async () =>
      announcementSchema.parse(await ipcRenderer.invoke(updateChannels.announcement)),
    onChanged: (listener: () => void): (() => void) => {
      const forward = (): void => listener();
      ipcRenderer.on(updateChannels.changed, forward);
      return () => ipcRenderer.removeListener(updateChannels.changed, forward);
    },
  },
  storage: {
    status: async () => storageStatusSchema.parse(await ipcRenderer.invoke(storageChannels.status)),
    setPassphrase: async (passphrase: string) =>
      storageOutcomeSchema.parse(
        await ipcRenderer.invoke(storageChannels.setPassphrase, passphraseSchema.parse(passphrase)),
      ),
    storeUnprotected: async () =>
      storageOutcomeSchema.parse(await ipcRenderer.invoke(storageChannels.storeUnprotected)),
    unlock: async (passphrase: string) =>
      storageOutcomeSchema.parse(
        await ipcRenderer.invoke(storageChannels.unlock, unlockPassphraseSchema.parse(passphrase)),
      ),
  },
};

contextBridge.exposeInMainWorld("pochimail", api);

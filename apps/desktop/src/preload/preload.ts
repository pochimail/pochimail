import { contextBridge, ipcRenderer } from "electron";
import {
  type NotificationScreen,
  notificationScreenSchema,
  openScreenChannel,
} from "../shared/notifications.ts";
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

// A notification can be clicked before the page has subscribed (a window opened by the click), so the screen waits here.
let screenListener: ((screen: NotificationScreen) => void) | undefined;
let pendingScreen: NotificationScreen | undefined;

ipcRenderer.on(openScreenChannel, (_event, screen: unknown) => {
  const parsed = notificationScreenSchema.safeParse(screen);
  if (!parsed.success) return;
  if (screenListener === undefined) pendingScreen = parsed.data;
  else screenListener(parsed.data);
});

const api = {
  requestWorkerPort: (): void => {
    requested = true;
    deliver();
  },
  onOpenScreen: (listener: (screen: NotificationScreen) => void): (() => void) => {
    screenListener = listener;
    if (pendingScreen !== undefined) {
      listener(pendingScreen);
      pendingScreen = undefined;
    }
    return () => {
      if (screenListener === listener) screenListener = undefined;
    };
  },
  openMailAppLink: (link: string): Promise<void> =>
    ipcRenderer.invoke(osChannels.openMailAppLink, mailAppLinkSchema.parse(link)),
  showInFinder: (path: string): Promise<void> =>
    ipcRenderer.invoke(osChannels.showInFinder, folderPathSchema.parse(path)),
  chooseFolder: async (): Promise<string | null> =>
    chosenFolderSchema.parse(await ipcRenderer.invoke(osChannels.chooseFolder)),
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

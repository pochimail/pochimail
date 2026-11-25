/// <reference types="vite/client" />

interface Window {
  /** The preload's whole surface (src/preload/preload.ts). */
  pochimail: {
    requestWorkerPort: () => void;
    /** A clicked notification asks for a screen (src/shared/notifications.ts); returns the unsubscribe. */
    onOpenScreen: (
      listener: (screen: import("#shared/notifications.ts").NotificationScreen) => void,
    ) => () => void;
    openMailAppLink: (link: string) => Promise<void>;
    showInFinder: (path: string) => Promise<void>;
    chooseFolder: () => Promise<string | null>;
    /** The storage-protection prompt's calls (src/shared/storage-calls.ts); answers never carry key material. */
    storage: {
      status: () => Promise<import("#shared/storage-calls.ts").StorageStatus>;
      setPassphrase: (
        passphrase: string,
      ) => Promise<import("#shared/storage-calls.ts").StorageOutcome>;
      storeUnprotected: () => Promise<import("#shared/storage-calls.ts").StorageOutcome>;
      unlock: (passphrase: string) => Promise<import("#shared/storage-calls.ts").StorageOutcome>;
    };
  };
}

/** Replaced at build time (src/shared/gallery-build.ts): true only in dev and E2E builds. */
declare const __POCHIMAIL_GALLERY__: boolean;

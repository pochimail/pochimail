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
    /** The update notice's calls (src/shared/update-calls.ts): it only tells, nothing downloads or installs. */
    updates: {
      state: () => Promise<import("#shared/update-calls.ts").UpdateState>;
      checkNow: () => Promise<import("#shared/update-calls.ts").CheckResult>;
      setAutoCheck: (enabled: boolean) => Promise<void>;
      dismiss: (version: string) => Promise<void>;
      /** Opens the project's releases page in the default browser; the page never supplies the URL. */
      download: () => Promise<void>;
      /** The version to announce in a toast: handed out once per launch, then null. */
      announcement: () => Promise<string | null>;
      /** Fires when the announcement may have changed. Returns the way to stop listening. */
      onChanged: (listener: () => void) => () => void;
    };
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

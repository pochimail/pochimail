export interface SingleInstanceApp {
  requestSingleInstanceLock(): boolean;
  quit(): void;
  on(event: "second-instance", listener: () => void): unknown;
}

export interface FocusableWindow {
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
}

/** The one way to bring the app forward: the tray's "Open" item and a second launch both come here. */
export const focusOrCreateWindow = (
  windows: readonly FocusableWindow[],
  create: () => void,
): void => {
  const [window] = windows;
  if (window === undefined) {
    create();
    return;
  }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
};

/**
 * Two processes on one encrypted database corrupt it, so only one Pochimail runs per user data folder. A process that
 * does not get the lock asks to quit and must start nothing; the one that holds it answers a second launch by showing its window.
 */
export const holdSingleInstanceLock = (
  app: SingleInstanceApp,
  openOrFocus: () => void,
): boolean => {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }
  app.on("second-instance", openOrFocus);
  return true;
};

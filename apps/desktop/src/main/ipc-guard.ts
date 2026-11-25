export type IpcSender = { senderFrame?: { url: string } | null };
export type IpcHandle = (
  channel: string,
  listener: (event: IpcSender, ...args: unknown[]) => unknown,
) => void;

/** Wraps a main-process handler so a frame that is not the app's own page (an injected iframe, a navigated window) is refused. */
export const onlyFromAppPage =
  (isAppUrl: (url: string) => boolean) =>
  <T>(run: (...args: unknown[]) => T) =>
  (event: IpcSender, ...args: unknown[]): T => {
    const url = event.senderFrame?.url;
    if (url === undefined || !isAppUrl(url)) throw new Error("call refused: unknown sender");
    return run(...args);
  };

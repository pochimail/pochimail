import { isAbsolute, relative, resolve } from "node:path";
import {
  chosenFolderSchema,
  folderPathSchema,
  mailAppLinkSchema,
  osChannels,
} from "../shared/os-calls.ts";
import { type IpcHandle, onlyFromAppPage } from "./ipc-guard.ts";

export type OsCallDeps = {
  ipc: { handle: IpcHandle };
  openExternal: (url: string) => Promise<void>;
  showItemInFolder: (path: string) => void;
  chooseFolder: () => Promise<string | null>;
  isAppUrl: (url: string) => boolean;
  /** App-owned folders (e.g. userData) that may be revealed without the user having picked them. */
  appDataDirs: () => string[];
};

const isInside = (root: string, path: string): boolean => {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

/**
 * The OS `ipcMain` handlers (the storage prompt's are in storage-calls.ts). They carry no mail data: renderer <-> worker traffic uses the MessagePort and
 * never reaches main. Calls from any frame that is not the app's own page are refused.
 */
export const registerOsCalls = (deps: OsCallDeps): void => {
  // showInFinder is not a general file-reveal: only folders the user picked, or the app's own data folders.
  const pickedFolders = new Set<string>();
  const guarded = onlyFromAppPage(deps.isAppUrl);

  deps.ipc.handle(
    osChannels.openMailAppLink,
    guarded((link) => deps.openExternal(mailAppLinkSchema.parse(link))),
  );
  deps.ipc.handle(
    osChannels.showInFinder,
    guarded((rawPath) => {
      const path = folderPathSchema.parse(rawPath);
      const allowed = [...pickedFolders, ...deps.appDataDirs()].some((root) =>
        isInside(root, path),
      );
      if (!allowed) throw new Error("os call refused: path was not chosen by the user");
      deps.showItemInFolder(path);
    }),
  );
  deps.ipc.handle(
    osChannels.chooseFolder,
    guarded(async () => {
      const folder = chosenFolderSchema.parse(await deps.chooseFolder());
      if (folder !== null) pickedFolders.add(folder);
      return folder;
    }),
  );
};

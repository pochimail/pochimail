import {
  autoCheckSchema,
  RELEASES_URL,
  updateChannels,
  versionSchema,
} from "../../shared/update-calls.ts";
import { type IpcHandle, onlyFromAppPage } from "../ipc-guard.ts";
import type { UpdateService } from "./update-service.ts";

export type UpdateCallDeps = {
  ipc: { handle: IpcHandle };
  service: UpdateService;
  openExternal: (url: string) => Promise<void>;
  /** Tells every window that the announcement may have changed. */
  broadcastChanged: () => void;
  isAppUrl: (url: string) => boolean;
};

/**
 * The update notice's `ipcMain` handlers. Arguments are validated again here; the Download call takes no argument and
 * opens the app's own constant URL. Calls from any frame that is not the app's own page are refused.
 */
export const registerUpdateCalls = ({
  ipc,
  service,
  openExternal,
  broadcastChanged,
  isAppUrl,
}: UpdateCallDeps): void => {
  const guarded = onlyFromAppPage(isAppUrl);
  ipc.handle(
    updateChannels.state,
    guarded(() => service.state()),
  );
  ipc.handle(
    updateChannels.checkNow,
    guarded(() => service.checkNow()),
  );
  ipc.handle(
    updateChannels.setAutoCheck,
    guarded((enabled) => service.setAutoCheck(autoCheckSchema.parse(enabled))),
  );
  ipc.handle(
    updateChannels.dismiss,
    guarded((version) => service.dismiss(versionSchema.parse(version))),
  );
  ipc.handle(
    updateChannels.download,
    guarded(() => openExternal(RELEASES_URL)),
  );
  ipc.handle(
    updateChannels.announcement,
    guarded(() => service.takeAnnouncement()),
  );
  service.onChange(broadcastChanged);
};

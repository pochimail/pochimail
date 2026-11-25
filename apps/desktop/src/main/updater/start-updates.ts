import type { Logger } from "@pochimail/logger/logger";
import { egressPolicy } from "@pochimail/net/egress/allowlist";
import type { StreamFetch } from "@pochimail/net/egress/model-download";
import { createVersionFileReader } from "@pochimail/net/egress/version-file";
import type { Timer } from "@pochimail/pipeline/event-batching";
import { updateChannels, VERSION_FILE_URL } from "../../shared/update-calls.ts";
import { registerUpdateCalls, type UpdateCallDeps } from "./update-calls.ts";
import { createUpdatePreferences } from "./update-preferences.ts";
import { createUpdateService } from "./update-service.ts";

const realTimer: Timer = {
  set: (fn, ms) => {
    const handle = setTimeout(fn, ms);
    return () => clearTimeout(handle);
  },
};

export type StartUpdatesDeps = Pick<UpdateCallDeps, "ipc" | "openExternal" | "isAppUrl"> & {
  /** True only in a build made by the release workflow (`POCHIMAIL_RELEASE_BUILD`, replaced at build time). */
  releaseBuild: boolean;
  env: { readonly POCHIMAIL_SMOKE?: string | undefined };
  currentVersion: string;
  preferencesFile: string;
  /** The open windows: each is told when the announcement may have changed. */
  windows: () => readonly { webContents: { send: (channel: string) => void } }[];
  timer?: Timer;
  logger: Logger;
  fetch?: StreamFetch;
};

/**
 * Starts the update notice for this process and registers its calls. Dev, PR and smoke builds are never release builds, and
 * a release build launched by the packaging smoke stays quiet too: only a person's launch of a released app contacts GitHub.
 * Returns the way to stop the schedule.
 */
export const startUpdates = (deps: StartUpdatesDeps): (() => void) => {
  const read = createVersionFileReader({
    allowlist: egressPolicy.createForUpdateCheck(),
    ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
    logger: deps.logger,
  });
  const service = createUpdateService({
    enabled: deps.releaseBuild && deps.env.POCHIMAIL_SMOKE !== "1",
    currentVersion: deps.currentVersion,
    fetchVersionFile: () => read(VERSION_FILE_URL),
    timer: deps.timer ?? realTimer,
    preferences: createUpdatePreferences(deps.preferencesFile),
    logger: deps.logger,
  });
  registerUpdateCalls({
    ...deps,
    service,
    broadcastChanged: () => {
      for (const window of deps.windows()) window.webContents.send(updateChannels.changed);
    },
  });
  service.start();
  return service.stop;
};

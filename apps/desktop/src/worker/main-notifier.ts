import { ok } from "@pochimail/kernel/result";
import type { Notifier } from "@pochimail/workflows/ports/notifier";
import type { NotifyMessage } from "../shared/notifications.ts";
import type { ManageSettings } from "./manage-settings.ts";

/**
 * The worker's Notifier: when the Notifications setting is on, it hands the kind and count to main, which shows
 * it. It never fails the caller: a notification that cannot be shown is not worth failing a scan for.
 */
export const createMainNotifier = (deps: {
  readonly settings: Pick<ManageSettings, "get">;
  readonly workspaceId: Parameters<ManageSettings["get"]>[0];
  readonly send: (message: NotifyMessage) => void;
}): Notifier => ({
  async notify({ kind, count }) {
    const settings = await deps.settings.get(deps.workspaceId);
    if (settings.ok && settings.value.notifications)
      deps.send({ type: "notify", kind, count, locale: settings.value.locale });
    return ok(undefined);
  },
});

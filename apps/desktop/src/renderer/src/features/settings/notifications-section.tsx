import { Switch } from "@pochimail/ui/components/switch";
import { useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import { cn } from "@pochimail/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type AppSettings, DEFAULT_APP_SETTINGS } from "#shared/settings.ts";
import { queryKeys } from "../../lib/query/keys.ts";
import { SECTION_TITLE_CLASS } from "../../lib/screen-heading.tsx";
import { useWorkerClient } from "../../lib/worker-context.tsx";

/** Settings › Notifications: Pochimail's own notifications, not the mail category of that name. */
export function NotificationsSection({ rowClassName }: { rowClassName: string }) {
  const t = useT();
  const client = useWorkerClient();
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: queryKeys.settings(),
    queryFn: () => client.call("settings.get"),
  });
  const enabled = settings.data?.notifications ?? DEFAULT_APP_SETTINGS.notifications;

  const toggle = async (notifications: boolean) => {
    queryClient.setQueryData(queryKeys.settings(), (current: AppSettings | undefined) => ({
      ...(current ?? DEFAULT_APP_SETTINGS),
      notifications,
    }));
    try {
      await client.call("settings.update", { notifications });
    } catch {
      // Keep the visible choice: a failed write must not silently snap the control back.
    }
  };

  return (
    <section aria-labelledby="settings-notifications" className="flex flex-col gap-2">
      <h2 id="settings-notifications" className={cn("mx-1", SECTION_TITLE_CLASS)}>
        {t("settings.notifications")}
      </h2>
      <ul className="m-0 list-none rounded-2xl border border-border bg-card p-0">
        <li className={rowClassName}>
          <span className="flex flex-1 flex-col">
            <span id="settings-notifications-label" className="text-body font-medium">
              {t("settings.notifications.toggle")}
            </span>
            <span id="settings-notifications-hint" className="text-muted-foreground">
              {t("settings.notifications.hint")}
            </span>
          </span>
          <Switch
            checked={enabled}
            onCheckedChange={(next) => void toggle(next)}
            aria-labelledby="settings-notifications-label"
            aria-describedby="settings-notifications-hint"
          />
        </li>
      </ul>
    </section>
  );
}

import { toast } from "@pochimail/ui/components/sonner";
import { Switch } from "@pochimail/ui/components/switch";
import { useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import { cn } from "@pochimail/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellIcon } from "lucide-react";
import { type AppSettings, DEFAULT_APP_SETTINGS } from "#shared/settings.ts";
import { queryKeys } from "../../lib/query/keys.ts";
import { SECTION_TITLE_CLASS } from "../../lib/screen-heading.tsx";
import { useWorkerClient } from "../../lib/worker-context.tsx";
import { SETTINGS_ROW } from "./settings-row.ts";

/** Settings › Notifications: the one switch for Pochimail's own notifications (ADR 0008). The bell is reserved for this section. */
export function NotificationsSection() {
  const t = useT();
  const client = useWorkerClient();
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: queryKeys.settings(),
    queryFn: () => client.call("settings.get"),
  });
  const enabled = settings.data?.notifications ?? DEFAULT_APP_SETTINGS.notifications;

  const setNotifications = (notifications: boolean) =>
    queryClient.setQueryData(queryKeys.settings(), (current: AppSettings | undefined) => ({
      ...(current ?? DEFAULT_APP_SETTINGS),
      notifications,
    }));

  const change = async (next: boolean) => {
    setNotifications(next);
    try {
      await client.call("settings.update", { notifications: next });
    } catch {
      // Only this field goes back: a theme or language chosen meanwhile stays.
      setNotifications(!next);
      toast.error(t("settings.saveFailed"));
    }
  };

  return (
    <section aria-labelledby="settings-notifications" className="flex flex-col gap-2">
      <h2 id="settings-notifications" className={cn("mx-1", SECTION_TITLE_CLASS)}>
        {t("settings.notifications")}
      </h2>
      <ul className="m-0 list-none rounded-2xl border border-border bg-card p-0">
        <li className={SETTINGS_ROW}>
          <BellIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span id="settings-notifications-label" className="text-body font-medium">
              {t("settings.notifications.label")}
            </span>
            <span id="settings-notifications-hint" className="text-ui text-muted-foreground">
              {t("settings.notifications.hint")}
            </span>
          </span>
          <Switch
            checked={enabled}
            disabled={settings.data === undefined}
            aria-labelledby="settings-notifications-label"
            aria-describedby="settings-notifications-hint"
            onCheckedChange={(next) => void change(next)}
          />
        </li>
      </ul>
    </section>
  );
}

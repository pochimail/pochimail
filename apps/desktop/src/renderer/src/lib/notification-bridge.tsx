import { useEffect } from "react";
import type { NotificationScreen } from "#shared/notifications.ts";
import type { AppRouter } from "../router.tsx";

const PATH_OF_SCREEN: Record<NotificationScreen, "/overview" | "/review"> = {
  overview: "/overview",
  review: "/review",
};

/** Opens the screen a clicked notification names. Outside the app shell (tests, stories) there is no preload and nothing to do. */
export function NotificationBridge({ router }: { router: AppRouter }) {
  useEffect(
    () =>
      window.pochimail?.onOpenScreen((screen) => {
        void router.navigate({ to: PATH_OF_SCREEN[screen] });
      }),
    [router],
  );
  return null;
}

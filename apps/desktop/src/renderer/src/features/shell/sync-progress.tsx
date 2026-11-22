import { useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import { MOTION, transition } from "@pochimail/ui/lib/motion";
import { useScanStatus } from "../../lib/scan-status.tsx";

/**
 * A hairline at the top of the app: it overlays the shell, so appearing or disappearing never moves the page.
 * The number comes only from live worker jobs and progress events; no timer runs when nothing is syncing.
 */
export function SyncProgress({ accountIds }: { readonly accountIds: readonly string[] }) {
  const t = useT();
  const { active, percent, total } = useScanStatus(accountIds);
  if (!active) return null;

  const pct = Math.round(Math.min(100, Math.max(0, percent)));
  return (
    <div
      data-slot="sync-progress"
      role="progressbar"
      aria-label={t("sync.progress")}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={total === null ? undefined : pct}
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 bg-muted"
    >
      <div
        className="h-full bg-primary"
        style={{
          width: `${pct}%`,
          transition: transition({ property: "width", ms: MOTION.progressMs }),
        }}
      />
    </div>
  );
}

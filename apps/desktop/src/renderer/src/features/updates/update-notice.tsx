import { toast } from "@pochimail/ui/components/sonner";
import { useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import { useEffect } from "react";
import { useUpdates } from "./updates-context.tsx";

/**
 * Shows the update toast. Main hands the version out at most once per launch (and never a dismissed one); this asks when the
 * window opens and again whenever main says it may have changed. Dismissing is remembered for that version.
 */
export function UpdateNotice() {
  const updates = useUpdates();
  const t = useT();

  useEffect(() => {
    if (updates === null) return;
    const announce = async (): Promise<void> => {
      const version = await updates.announcement().catch(() => null);
      if (version === null) return;
      const remember = (): void => void updates.dismiss(version).catch(() => undefined);
      toast(t("update.available", { version }), {
        duration: Number.POSITIVE_INFINITY,
        closeButton: true,
        onDismiss: remember,
        action: {
          label: t("update.download"),
          onClick: () => {
            void updates.download().catch(() => undefined);
            remember();
          },
        },
      });
    };
    void announce();
    return updates.onChanged(() => void announce());
  }, [updates, t]);

  return null;
}

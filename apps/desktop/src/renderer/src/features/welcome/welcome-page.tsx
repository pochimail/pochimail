import { Button } from "@pochimail/ui/components/button";
import { useLocale, useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import { deviceLabel } from "@pochimail/ui/i18n/locale.ts";
import { cn } from "@pochimail/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { queryKeys } from "../../lib/query/keys.ts";
import { useWorkerClient } from "../../lib/worker-context.tsx";

export function WelcomePage() {
  const t = useT();
  const locale = useLocale();
  const client = useWorkerClient();
  const deviceName = useQuery({
    queryKey: queryKeys.deviceName(),
    queryFn: () => client.call("device.name"),
  });
  const device = deviceLabel(deviceName.data ?? "device", locale);

  return (
    <div className="flex flex-col items-center gap-4.5">
      <h1 className="text-balance text-display leading-heading">{t("welcome.headline")}</h1>
      {/* Held invisible until the device name resolves, so the copy never flips from "device" to "Mac". */}
      <p
        className={cn(
          "max-w-narrow text-pretty text-base leading-copy text-muted-foreground",
          deviceName.isPending && "invisible",
        )}
      >
        {t("welcome.description", { device })}
      </p>
      <div className="mt-1.5 flex flex-col items-center gap-3">
        <Button asChild size="lg" className="min-w-65 text-body">
          <Link to="/connect">{t("welcome.cta")}</Link>
        </Button>
        <p className="text-caption leading-4 text-foreground-tertiary">{t("welcome.openSource")}</p>
      </div>
    </div>
  );
}

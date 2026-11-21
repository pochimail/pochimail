import { Mascot } from "@pochimail/ui/components/mascot";
import { useLocale, useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import { deviceLabel } from "@pochimail/ui/i18n/locale.ts";

const PROMISES = ["local", "control", "delete"] as const;

/** "My promises": what Pochimail commits to before any account is connected (docs/product.md). */
export function ConnectPromises({ device }: { device: string }) {
  const t = useT();
  const locale = useLocale();
  const label = deviceLabel(device, locale);
  return (
    <section aria-labelledby="connect-promises" className="flex flex-1 basis-75 flex-col text-left">
      <div className="flex items-center gap-4">
        <Mascot size="sm" />
        <h2 id="connect-promises" className="m-0 font-sans text-section font-semibold">
          {t("connect.promises.heading")}
        </h2>
      </div>
      <ul className="m-0 mt-1.5 list-none border-b border-border p-0">
        {PROMISES.map((promise) => (
          <li key={promise} className="flex flex-col gap-0.5 border-t border-border py-3.5">
            <span className="text-body font-semibold">
              {t(`connect.promise.${promise}.title`, { device: label })}
            </span>
            <span className="text-ui leading-normal text-muted-foreground">
              {t(`connect.promise.${promise}.body`)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

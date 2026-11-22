import { Mascot, type MascotPose } from "@pochimail/ui/components/mascot";
import { useLocale, useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import { deviceLabel } from "@pochimail/ui/i18n/locale.ts";

const PROMISES = ["local", "control", "delete"] as const;

/** "My promises": what Pochimail commits to before any account is connected (docs/product.md). */
export function ConnectPromises({ device, pose }: { device: string; pose: MascotPose }) {
  const t = useT();
  const locale = useLocale();
  const label = deviceLabel(device, locale);
  return (
    <section aria-labelledby="connect-promises" className="flex flex-1 basis-75 flex-col text-left">
      {/* Pochi is twice the xs width here; the callout reuses SpeechBubble's tokens and tail, which the
          shared component cannot do here because it fixes the mascot at sm. */}
      <div data-slot="speech-bubble" className="flex items-start gap-4">
        <Mascot size="xs" className="w-20" pose={pose} />
        <div
          data-slot="speech-bubble-body"
          className="relative min-w-0 flex-1 rounded-xl bg-card px-4 py-3 text-left text-body leading-normal break-words text-card-foreground shadow-[inset_0_0_0_1px_var(--border)]"
        >
          <span
            aria-hidden="true"
            data-slot="speech-bubble-tail"
            className="absolute top-5 -left-1.5 size-2.75 rotate-45 bg-card shadow-[-1px_1px_0_var(--border)]"
          />
          <h2 id="connect-promises" className="m-0 font-sans text-section font-semibold">
            {t("connect.promises.heading")}
          </h2>
          <ul className="m-0 mt-1.5 list-none p-0">
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
        </div>
      </div>
    </section>
  );
}

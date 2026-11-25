import type { T } from "@pochimail/ui/i18n/i18n-provider.tsx";
import type { UserLocale } from "@pochimail/ui/i18n/messages.ts";
import type { OverviewData } from "./overview-figures.ts";
import { freeSizeLabel, overviewFigures, sizeLabel } from "./overview-figures.ts";

/** Cumulative action figures and deletable size (#114), apart from the two decision sections. */
export function FiguresSection({
  data,
  t,
  locale,
}: {
  readonly data: OverviewData;
  readonly t: T;
  readonly locale: UserLocale;
}) {
  const figures = overviewFigures(data);
  if (data.figures.deletableSize === 0 && figures.length === 0) return null;
  return (
    <div className="flex flex-col gap-4">
      {data.figures.deletableSize > 0 && (
        <p className="font-display text-title-sm font-title tabular-nums">
          {freeSizeLabel(data.figures.deletableSize, data.figures.totalSize, t)}
        </p>
      )}
      {figures.length > 0 && (
        <dl className="grid grid-cols-3 gap-4">
          {figures.map((figure) => (
            <div key={figure.labelKey} className="flex flex-col-reverse">
              <dt className="text-ui text-muted-foreground">
                {figure.sizeBytes === undefined
                  ? t(figure.labelKey)
                  : t("storageBar.legendItem", {
                      label: t(figure.labelKey),
                      size: sizeLabel(figure.sizeBytes, t),
                    })}
              </dt>
              <dd className="font-display text-3xl tabular-nums">
                {figure.count.toLocaleString(locale)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

import { useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import { cn } from "@pochimail/ui/lib/utils";
import type { ReactNode } from "react";
import { PAGE_MAIN_CLASS, PageHeading, SECTION_TITLE_CLASS } from "../../lib/screen-heading.tsx";
import { SETTINGS_ROW } from "../../lib/settings-row.ts";
import { LanguageDropdown, ThemeSegments } from "./appearance-controls.tsx";

/** Settings › Appearance: the reference's Theme segmented radio plus the language row (JD's addition). Other sections are passed in by the route. */
export function SettingsPage({ children }: { children?: ReactNode }) {
  const t = useT();

  return (
    <main className={PAGE_MAIN_CLASS}>
      <PageHeading title={t("settings.title")} note={t("settings.description")} />

      <section aria-labelledby="settings-appearance" className="flex flex-col gap-2">
        <h2 id="settings-appearance" className={cn("mx-1", SECTION_TITLE_CLASS)}>
          {t("settings.appearance")}
        </h2>
        <ul className="m-0 list-none rounded-2xl border border-border bg-card p-0">
          <li className={SETTINGS_ROW}>
            <span className="flex-1 text-body font-medium">{t("appearance.theme")}</span>
            <ThemeSegments />
          </li>
          <li className={SETTINGS_ROW}>
            <span className="flex-1 text-body font-medium">{t("appearance.language")}</span>
            <LanguageDropdown />
          </li>
        </ul>
      </section>

      {children}
    </main>
  );
}

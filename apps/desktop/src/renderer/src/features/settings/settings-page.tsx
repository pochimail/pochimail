import { useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import { cn } from "@pochimail/ui/lib/utils";
import { PAGE_MAIN_CLASS, PageHeading, SECTION_TITLE_CLASS } from "../../lib/screen-heading.tsx";
import { LanguageDropdown, ThemeSegments } from "./appearance-controls.tsx";

const ROW =
  "flex min-h-14 items-center gap-3.5 border-b border-border px-4.5 py-2.5 last:border-b-0";

/** Settings › Appearance: the reference's Theme segmented radio plus the language row (JD's addition). */
export function SettingsPage() {
  const t = useT();

  return (
    <main className={cn(PAGE_MAIN_CLASS, "max-w-2xl")}>
      <PageHeading title={t("settings.title")} note={t("settings.description")} />

      <section aria-labelledby="settings-appearance" className="flex flex-col gap-2">
        <h2 id="settings-appearance" className={cn("mx-1", SECTION_TITLE_CLASS)}>
          {t("settings.appearance")}
        </h2>
        <ul className="m-0 list-none rounded-2xl border border-border bg-card p-0">
          <li className={ROW}>
            <span className="flex-1 text-body font-medium">{t("appearance.theme")}</span>
            <ThemeSegments />
          </li>
          <li className={ROW}>
            <span className="flex-1 text-body font-medium">{t("appearance.language")}</span>
            <LanguageDropdown />
          </li>
        </ul>
      </section>
    </main>
  );
}

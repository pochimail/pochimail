import { useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import { PAGE_MAIN_CLASS, PageHeading } from "../../lib/screen-heading.tsx";
import { AccountsSection } from "./accounts-section.tsx";
import { LanguageDropdown, ThemeSegments } from "./appearance-controls.tsx";
import { SETTINGS_ROW, SettingsSection } from "./settings-section.tsx";

/** Settings: the reference's Accounts section, then Appearance (the Theme segmented radio plus the language row, JD's addition). */
export function SettingsPage() {
  const t = useT();

  return (
    <main className={PAGE_MAIN_CLASS}>
      <PageHeading title={t("settings.title")} note={t("settings.description")} />

      <AccountsSection />

      <SettingsSection id="settings-appearance" title={t("settings.appearance")}>
        <li className={SETTINGS_ROW}>
          <span className="flex-1 text-body font-medium">{t("appearance.theme")}</span>
          <ThemeSegments />
        </li>
        <li className={SETTINGS_ROW}>
          <span className="flex-1 text-body font-medium">{t("appearance.language")}</span>
          <LanguageDropdown />
        </li>
      </SettingsSection>
    </main>
  );
}

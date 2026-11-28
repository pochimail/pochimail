import { useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import type { ReactNode } from "react";
import { PAGE_MAIN_CLASS, PageHeading } from "../../lib/screen-heading.tsx";
import { SETTINGS_ROW } from "../../lib/settings-row.ts";
import { AccountsSection } from "./accounts-section.tsx";
import { LanguageDropdown, ThemeSegments } from "./appearance-controls.tsx";
import { NotificationsSection } from "./notifications-section.tsx";
import { SettingsSection } from "./settings-section.tsx";

/** Settings: the reference's Accounts section, then Appearance (the Theme segmented radio plus the language row, JD's addition). Other sections are passed in by the route. */
export function SettingsPage({ children }: { children?: ReactNode }) {
  const t = useT();

  return (
    <main className={PAGE_MAIN_CLASS}>
      <PageHeading title={t("settings.title")} note={t("settings.description")} />

      <AccountsSection />

      <NotificationsSection />

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

      {children}
    </main>
  );
}

import { RadioGroup, RadioGroupItem } from "@pochimail/ui/components/radio-group";
import { useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import { THEMES } from "#shared/settings.ts";
import { useAppearance } from "./appearance.tsx";
import { LanguageSelect } from "./appearance-controls.tsx";

const ROW =
  "flex min-h-14 items-center gap-3.5 border-b border-border px-4.5 py-2.5 last:border-b-0";

/** Settings › Appearance: the reference's Theme segmented radio plus the language row (JD's addition). */
export function SettingsPage() {
  const t = useT();
  const { theme, selectTheme } = useAppearance();

  return (
    <main className="mx-auto max-w-2xl px-8 pt-16">
      <h1 className="text-4xl">{t("settings.title")}</h1>
      <p className="mt-4 text-muted-foreground">{t("settings.description")}</p>

      <section aria-labelledby="settings-appearance" className="mt-10 flex flex-col gap-2">
        <h2 id="settings-appearance" className="mx-1 text-section">
          {t("settings.appearance")}
        </h2>
        <ul className="m-0 list-none rounded-2xl border border-border bg-card p-0">
          <li className={ROW}>
            <span className="flex-1 text-body font-medium">{t("appearance.theme")}</span>
            <RadioGroup
              value={theme}
              aria-label={t("appearance.theme")}
              onValueChange={(value) => {
                const next = THEMES.find((item) => item === value);
                if (next !== undefined) void selectTheme(next);
              }}
              className="flex shrink-0 gap-0.5 rounded-xl bg-muted p-0.75"
            >
              {THEMES.map((value) => (
                <label
                  key={value}
                  htmlFor={`settings-theme-${value}`}
                  className="flex h-7.5 cursor-pointer items-center rounded-lg px-3 text-caption font-medium text-muted-foreground has-[[data-state=checked]]:bg-background has-[[data-state=checked]]:text-foreground has-[[data-state=checked]]:shadow-sm"
                >
                  <RadioGroupItem
                    id={`settings-theme-${value}`}
                    value={value}
                    aria-labelledby={`settings-theme-${value}-label`}
                    className="sr-only"
                  />
                  <span id={`settings-theme-${value}-label`}>{t(`appearance.theme.${value}`)}</span>
                </label>
              ))}
            </RadioGroup>
          </li>
          <li className={ROW}>
            <span className="flex-1 text-body font-medium">{t("appearance.language")}</span>
            <LanguageSelect />
          </li>
        </ul>
      </section>
    </main>
  );
}

import { Button } from "@pochimail/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@pochimail/ui/components/dropdown-menu";
import { useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import type { MessageKey, UserLocale } from "@pochimail/ui/i18n/messages.ts";
import { LanguagesIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import type { ComponentType } from "react";
import { SETTINGS_LOCALES, THEMES, type Theme } from "#shared/settings.ts";
import { useAppearance } from "./appearance.tsx";

const THEME_ICONS: Record<Theme, ComponentType> = {
  system: MonitorIcon,
  light: SunIcon,
  dark: MoonIcon,
};
const LOCALE_LABELS: Record<UserLocale, MessageKey> = {
  en: "appearance.locale.en",
  fr: "appearance.locale.fr",
  ja: "appearance.locale.ja",
};

/** Menus are shared by the frame's icon buttons and the labeled Settings row: one way to choose. */
function ThemeChoices() {
  const { theme, selectTheme } = useAppearance();
  const t = useT();
  return (
    <DropdownMenuRadioGroup
      value={theme}
      onValueChange={(value) => {
        const next = THEMES.find((item) => item === value);
        if (next !== undefined) void selectTheme(next);
      }}
    >
      {THEMES.map((value) => (
        <DropdownMenuRadioItem key={value} value={value}>
          {t(`appearance.theme.${value}`)}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

function LanguageChoices() {
  const { locale, selectLocale } = useAppearance();
  const t = useT();
  return (
    <DropdownMenuRadioGroup
      value={locale}
      onValueChange={(value) => {
        const next = SETTINGS_LOCALES.find((item) => item === value);
        if (next !== undefined) void selectLocale(next);
      }}
    >
      {SETTINGS_LOCALES.map((value) => (
        <DropdownMenuRadioItem key={value} value={value}>
          {t(LOCALE_LABELS[value])}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

function ThemeButton() {
  const { theme } = useAppearance();
  const t = useT();
  const Icon = THEME_ICONS[theme];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("appearance.theme")}>
          <Icon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("appearance.theme")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <ThemeChoices />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LanguageButton() {
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("appearance.language")}>
          <LanguagesIcon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("appearance.language")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <LanguageChoices />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Compact theme and language controls for the app frame: icon buttons, real menus, visible focus. */
export function AppearanceControls() {
  return (
    <div data-slot="appearance-controls" className="flex items-center gap-1">
      <ThemeButton />
      <LanguageButton />
    </div>
  );
}

/** The Settings row's labeled language control; shares the same menu and controller as the icon button. */
export function LanguageSelect() {
  const { locale } = useAppearance();
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" aria-label={t("appearance.language")}>
          {t(LOCALE_LABELS[locale])}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("appearance.language")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <LanguageChoices />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

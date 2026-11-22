import { Button } from "@pochimail/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@pochimail/ui/components/dropdown-menu";
import { RadioGroup, SegmentedRadioItem } from "@pochimail/ui/components/radio-group";
import { useT } from "@pochimail/ui/i18n/i18n-provider.tsx";
import type { MessageKey, UserLocale } from "@pochimail/ui/i18n/messages.ts";
import { cn } from "@pochimail/ui/lib/utils";
import { ChevronDownIcon, type LucideIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { SETTINGS_LOCALES, THEMES, type Theme } from "#shared/settings.ts";
import { useAppearance } from "./appearance.tsx";

const THEME_ICONS: Record<Theme, LucideIcon> = {
  system: MonitorIcon,
  light: SunIcon,
  dark: MoonIcon,
};
const LOCALE_LABELS: Record<UserLocale, MessageKey> = {
  en: "appearance.locale.en",
  fr: "appearance.locale.fr",
  ja: "appearance.locale.ja",
};

// Settings.html's Theme control: 3px inset, 2px gaps, control-radius group, 30px text choices.
// No popover and no menu — the choices are always visible and clickable. Radii use theme tokens.
const GROUP = "flex max-w-full flex-wrap gap-0.5 rounded-md bg-muted p-0.75";

/** Theme choices, shared by the compact frame control and the labeled Settings row. */
export function ThemeSegments({ compact = false }: { compact?: boolean }) {
  const { theme, selectTheme } = useAppearance();
  const t = useT();
  return (
    <RadioGroup
      value={theme}
      aria-label={t("appearance.theme")}
      onValueChange={(value) => {
        const next = THEMES.find((item) => item === value);
        if (next !== undefined) void selectTheme(next);
      }}
      className={GROUP}
    >
      {THEMES.map((value) => {
        const label = t(`appearance.theme.${value}`);
        const Icon = THEME_ICONS[value];
        return (
          <SegmentedRadioItem
            key={value}
            value={value}
            aria-label={label}
            title={label}
            className={cn(compact && "px-2")}
          >
            {compact ? <Icon aria-hidden="true" className="size-3.5" /> : label}
          </SegmentedRadioItem>
        );
      })}
    </RadioGroup>
  );
}

/**
 * Language choices: one compact trigger showing the current locale, with a menu of the shipped
 * locales. Shared by the frame and the Settings row so there is a single way to choose a language.
 */
export function LanguageDropdown() {
  const { locale, selectLocale } = useAppearance();
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          aria-label={t("appearance.language")}
          className="min-w-0 max-w-full shrink gap-1"
        >
          <span className="min-w-0 truncate">{t(LOCALE_LABELS[locale])}</span>
          <ChevronDownIcon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Compact theme segments and the language dropdown for the frame and onboarding header. */
export function AppearanceControls() {
  return (
    <div
      data-slot="appearance-controls"
      className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1.5"
    >
      <ThemeSegments compact />
      <LanguageDropdown />
    </div>
  );
}

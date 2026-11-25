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
import {
  ChevronDownIcon,
  GlobeIcon,
  type LucideIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
} from "lucide-react";
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
// The compact group is exactly 32px tall (2px inset + 28px choices), matching the language button.
const GROUP = "flex shrink-0 gap-0.5 rounded-md bg-muted p-0.75";

/** Theme choices, shared by the compact onboarding control and the labeled Settings row. */
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
      className={cn(GROUP, compact && "p-0.5")}
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
            className={cn(compact && "h-7 min-w-8 px-2")}
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
 * locales. Shared by the onboarding header and the Settings row so there is one way to choose a language.
 */
export function LanguageDropdown({ compact = false }: { compact?: boolean }) {
  const { locale, selectLocale } = useAppearance();
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          aria-label={t("appearance.language")}
          className={cn(compact && "h-8 @max-phone:w-8 @max-phone:px-0 @max-phone:has-[>svg]:px-0")}
        >
          {compact ? (
            <>
              <GlobeIcon aria-hidden="true" className="@phone:hidden" />
              <span className="max-w-40 truncate @max-phone:hidden">
                {t(LOCALE_LABELS[locale])}
              </span>
              <ChevronDownIcon aria-hidden="true" className="@max-phone:hidden" />
            </>
          ) : (
            <>
              {t(LOCALE_LABELS[locale])}
              <ChevronDownIcon aria-hidden="true" />
            </>
          )}
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

/** Compact theme segments and the language dropdown for the sidebar-less onboarding header. */
export function AppearanceControls() {
  return (
    <div data-slot="appearance-controls" className="flex items-center gap-2">
      <ThemeSegments compact />
      <LanguageDropdown compact />
    </div>
  );
}

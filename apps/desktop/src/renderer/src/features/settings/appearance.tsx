import type { UserLocale } from "@pochimail/ui/i18n/messages.ts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { type AppSettings, DEFAULT_APP_SETTINGS, type Theme } from "#shared/settings.ts";
import { useAppLocale } from "../../lib/locale.ts";
import { queryKeys } from "../../lib/query/keys.ts";
import { followSystemTheme } from "../../lib/theme.ts";
import { useWorkerClient } from "../../lib/worker-context.tsx";

// Named aliases keep this .tsx free of type-only generics; the copy guard scans raw source as JSX.
type Persist = Promise<void>;
type ThemePatch = { readonly theme: Theme };
type LocalePatch = { readonly locale: UserLocale };
type SettingsPatch = ThemePatch | LocalePatch;

type Appearance = {
  readonly theme: Theme;
  readonly locale: UserLocale;
  readonly selectTheme: (theme: Theme) => Persist;
  readonly selectLocale: (locale: UserLocale) => Persist;
};

const AppearanceContext = createContext<Appearance | undefined>(undefined);

/**
 * One controller for the root `.dark` class and the UI language. A preference that has never been
 * chosen follows the OS; persistence is memory-only today, so the saved default means "not chosen".
 */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const client = useWorkerClient();
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: queryKeys.settings(),
    queryFn: () => client.call("settings.get"),
  });
  const systemLocale = useAppLocale();
  const [chosen, setChosen] = useState(false);
  const theme = settings.data?.theme ?? DEFAULT_APP_SETTINGS.theme;
  const savedLocale = settings.data?.locale;
  const needsSystemLocale =
    !chosen && (savedLocale === undefined || savedLocale === DEFAULT_APP_SETTINGS.locale);
  const locale = needsSystemLocale ? systemLocale : (savedLocale ?? systemLocale);

  useEffect(() => followSystemTheme(theme), [theme]);

  const select = useCallback(
    async (patch: SettingsPatch) => {
      try {
        await client.call("settings.update", patch);
        queryClient.setQueryData(queryKeys.settings(), (current: AppSettings | undefined) =>
          current === undefined ? current : { ...current, ...patch },
        );
      } catch {
        // Keep the OS-driven value until the write is possible again.
      }
    },
    [client, queryClient],
  );

  const value = useMemo<Appearance>(
    () => ({
      theme,
      locale,
      selectTheme: (theme) => select({ theme }),
      selectLocale: (locale) => {
        setChosen(true);
        return select({ locale });
      },
    }),
    [theme, locale, select],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

/** The saved appearance choices and their setters; the only state the frame and Settings screen share. */
export function useAppearance(): Appearance {
  const value = useContext(AppearanceContext);
  if (value === undefined) throw new Error("appearance controller is not mounted");
  return value;
}

import type { UserLocale } from "@pochimail/ui/i18n/messages.ts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { type AppSettings, DEFAULT_APP_SETTINGS, type Theme } from "#shared/settings.ts";
import { useAppLocale } from "../../lib/locale.ts";
import { queryKeys } from "../../lib/query/keys.ts";
import {
  applyTheme,
  followSystemTheme,
  prefersDark,
  resolveTheme,
  subscribeSystemDark,
} from "../../lib/theme.ts";
import { useWorkerClient } from "../../lib/worker-context.tsx";

// Named aliases keep this .tsx free of type-only generics; the copy guard scans raw source as JSX.
type Persist = Promise<void>;
type ThemePatch = { readonly theme: Theme };
type LocalePatch = { readonly locale: UserLocale };
type SettingsPatch = ThemePatch | LocalePatch;
/** A choice is visible immediately, even while the first settings read is still in flight. */
type PendingAppearance = Partial<Pick<AppSettings, "theme" | "locale">>;

type Appearance = {
  readonly theme: Theme;
  /** The theme on screen: "system" resolved against the OS. */
  readonly resolvedTheme: "light" | "dark";
  readonly locale: UserLocale;
  readonly selectTheme: (theme: Theme) => Persist;
  readonly selectLocale: (locale: UserLocale) => Persist;
};

const AppearanceContext = createContext<Appearance | undefined>(undefined);

/**
 * One controller for the root `.dark` class and the UI language. A `null` locale means "follow the
 * OS"; saving a concrete locale makes the choice explicit and survives provider remounts.
 */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const client = useWorkerClient();
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: queryKeys.settings(),
    queryFn: () => client.call("settings.get"),
  });
  const systemLocale = useAppLocale();
  const [pending, setPending] = useState<PendingAppearance>({});
  const theme = pending.theme ?? settings.data?.theme ?? DEFAULT_APP_SETTINGS.theme;
  const locale = pending.locale ?? settings.data?.locale ?? systemLocale;
  const systemDark = useSyncExternalStore(subscribeSystemDark, prefersDark);
  const resolvedTheme = resolveTheme(theme, systemDark);

  // Before paint: a saved choice arriving later and an OS switch must repaint in the same frame too.
  useLayoutEffect(() => followSystemTheme(theme), [theme]);
  // Once the authoritative settings arrive, the optimistic overlay is no longer needed.
  useEffect(() => {
    if (settings.data !== undefined) setPending({});
  }, [settings.data]);

  const select = useCallback(
    async (patch: SettingsPatch) => {
      // The click frame owns the repaint; the write can be slow without making the choice feel slow.
      if ("theme" in patch) applyTheme(patch.theme);
      setPending((current) => ({ ...current, ...patch }));
      queryClient.setQueryData(queryKeys.settings(), (current: AppSettings | undefined) => ({
        ...(current ?? DEFAULT_APP_SETTINGS),
        ...patch,
      }));
      try {
        await client.call("settings.update", patch);
      } catch {
        // Keep the visible choice: a failed write must not silently snap the control back.
      }
    },
    [client, queryClient],
  );

  const value = useMemo<Appearance>(
    () => ({
      theme,
      resolvedTheme,
      locale,
      selectTheme: (theme) => select({ theme }),
      selectLocale: (locale) => select({ locale }),
    }),
    [theme, resolvedTheme, locale, select],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

/** The saved appearance choices and their setters; the state onboarding and Settings share. */
export function useAppearance(): Appearance {
  const value = useContext(AppearanceContext);
  if (value === undefined) throw new Error("appearance controller is not mounted");
  return value;
}

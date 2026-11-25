import type { Theme } from "#shared/settings.ts";

const darkScheme = "(prefers-color-scheme: dark)";

export const prefersDark = (): boolean =>
  typeof window.matchMedia === "function" && window.matchMedia(darkScheme).matches;

/** What the screen actually shows for a preference: "system" resolves to the OS appearance. */
export const resolveTheme = (theme: Theme, systemDark: boolean): "light" | "dark" =>
  theme === "dark" || (theme === "system" && systemDark) ? "dark" : "light";

/** For `useSyncExternalStore`: re-render when the OS appearance changes. */
export const subscribeSystemDark = (onChange: () => void): (() => void) => {
  const query = typeof window.matchMedia === "function" ? window.matchMedia(darkScheme) : undefined;
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
};

/** The single synchronous writer of the root `.dark` class; safe to call inside a click handler. */
export const applyTheme = (theme: Theme): void => {
  document.documentElement.classList.toggle("dark", resolveTheme(theme, prefersDark()) === "dark");
};

/**
 * Mirrors the OS for "system" and pins Light/Dark otherwise. The stop function lets the caller replace
 * the listener when the preference changes; applying the class is never deferred to the OS event.
 */
export const followSystemTheme = (theme: Theme = "system"): (() => void) => {
  applyTheme(theme);
  const query = typeof window.matchMedia === "function" ? window.matchMedia(darkScheme) : undefined;
  const onChange = (): void => applyTheme(theme);
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
};

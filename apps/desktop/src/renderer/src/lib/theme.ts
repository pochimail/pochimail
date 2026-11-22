import type { Theme } from "#shared/settings.ts";

const darkScheme = "(prefers-color-scheme: dark)";

const prefersDark = (): boolean =>
  typeof window.matchMedia === "function" && window.matchMedia(darkScheme).matches;

/** The single synchronous writer of the root `.dark` class; safe to call inside a click handler. */
export const applyTheme = (theme: Theme): void => {
  document.documentElement.classList.toggle(
    "dark",
    theme === "dark" || (theme === "system" && prefersDark()),
  );
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

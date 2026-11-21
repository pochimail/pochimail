import type { Theme } from "#shared/settings.ts";

/**
 * The only writer of the root `.dark` class. Called without an argument it mirrors the OS (its original
 * contract); with a saved preference it mirrors the OS only for "system" and pins Light/Dark otherwise.
 * The stop function lets the caller replace the listener when the preference changes.
 */
export const followSystemTheme = (theme: Theme = "system"): (() => void) => {
  const query =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : undefined;
  const apply = (): void => {
    document.documentElement.classList.toggle(
      "dark",
      theme === "dark" || (theme === "system" && query?.matches === true),
    );
  };
  apply();
  query?.addEventListener("change", apply);
  return () => query?.removeEventListener("change", apply);
};

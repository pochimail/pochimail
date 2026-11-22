// @vitest-environment jsdom
import { I18nProvider } from "@pochimail/ui/i18n/i18n-provider.tsx";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ActivityPage } from "../features/activity/activity-page.tsx";
import { useAppLocale } from "./locale.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Root() {
  return (
    <I18nProvider locale={useAppLocale()}>
      <ActivityPage />
    </I18nProvider>
  );
}

// Guards: the OS language changing while the app runs, but the mounted screen staying in the old language.
it("re-renders a mounted screen when the OS language changes", () => {
  const languages = vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
  render(<Root />);
  const heading = screen.getByRole("heading", { level: 1 });
  expect(heading.textContent).toBe("Activity");

  languages.mockReturnValue(["fr-FR"]);
  act(() => {
    window.dispatchEvent(new Event("languagechange"));
  });
  expect(screen.getByRole("heading", { level: 1 })).toBe(heading);
  expect(heading.textContent).toBe("Activité");
});

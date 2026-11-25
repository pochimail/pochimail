// @vitest-environment jsdom
import { I18nProvider } from "@pochimail/ui/i18n/i18n-provider.tsx";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "./error-boundary.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Broken(): never {
  throw new Error("screen failed");
}

// Guards: a rename of the logged event blinding the E2E smoke, which looks for "renderer-error" in the console.
it("logs a render failure as the renderer-error event", () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  render(
    <I18nProvider locale="en">
      <AppErrorBoundary>
        <Broken />
      </AppErrorBoundary>
    </I18nProvider>,
  );
  const events = logged.mock.calls.flatMap(([line]) => {
    try {
      return [JSON.parse(String(line)) as { event?: string; message?: string }];
    } catch {
      return [];
    }
  });
  expect(events).toContainEqual(
    expect.objectContaining({ event: "renderer-error", message: "screen failed" }),
  );
});

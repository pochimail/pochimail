// @vitest-environment jsdom
// Guards: an update toast that shows twice, shows for nothing, opens a URL the app did not choose, forgets a dismissal, or a Settings row
// that installs something, appears in builds that never check, or ignores the switch.

import { Toaster, toast } from "@pochimail/ui/components/sonner";
import { I18nProvider } from "@pochimail/ui/i18n/i18n-provider.tsx";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CheckResult, UpdateState } from "#shared/update-calls.ts";
import { UpdateNotice } from "./update-notice.tsx";
import { type UpdatesApi, UpdatesProvider } from "./updates-context.tsx";
import { UpdatesSection } from "./updates-section.tsx";

afterEach(() => {
  toast.dismiss();
  cleanup();
});

// jsdom has no pointer capture, which Sonner's swipe handling calls on every pointer-down inside a toast.
Element.prototype.setPointerCapture ??= () => undefined;
Element.prototype.releasePointerCapture ??= () => undefined;

const fakeApi = (
  options: {
    announcements?: (string | null)[];
    state?: Partial<UpdateState>;
    check?: CheckResult;
  } = {},
) => {
  const announcements = [...(options.announcements ?? [])];
  let changed: (() => void) | undefined;
  const api = {
    state: vi.fn(async () => ({
      enabled: true,
      currentVersion: "1.0.0",
      autoCheck: true,
      latest: null,
      ...options.state,
    })),
    checkNow: vi.fn(async () => options.check ?? ({ status: "up-to-date" } as CheckResult)),
    setAutoCheck: vi.fn(async (_enabled: boolean) => undefined),
    dismiss: vi.fn(async (_version: string) => undefined),
    download: vi.fn(async () => undefined),
    announcement: vi.fn(async () => announcements.shift() ?? null),
    onChanged: (listener: () => void) => {
      changed = listener;
      return () => undefined;
    },
  } satisfies UpdatesApi;
  return { api, change: () => changed?.() };
};

const mount = (api: UpdatesApi | undefined, ui: React.ReactNode) =>
  render(
    <I18nProvider locale="en">
      <UpdatesProvider api={api}>{ui}</UpdatesProvider>
      <Toaster />
    </I18nProvider>,
  );

describe("update toast", () => {
  it("shows one toast with a Download button that opens the releases page and remembers the version", async () => {
    const { api } = fakeApi({ announcements: ["1.2.0"] });
    mount(api, <UpdateNotice />);
    expect(await screen.findByText("Pochimail 1.2.0 is available")).toBeTruthy();
    expect(screen.getAllByText("Pochimail 1.2.0 is available")).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(api.download).toHaveBeenCalledOnce();
    expect(api.download).toHaveBeenCalledWith();
    expect(api.dismiss).toHaveBeenCalledWith("1.2.0");
  });

  it("remembers the version when the toast is closed", async () => {
    const { api } = fakeApi({ announcements: ["1.2.0"] });
    mount(api, <UpdateNotice />);
    await screen.findByText("Pochimail 1.2.0 is available");
    await userEvent.click(screen.getByRole("button", { name: /close/i }));
    await waitFor(() => expect(api.dismiss).toHaveBeenCalledWith("1.2.0"));
    expect(api.download).not.toHaveBeenCalled();
  });

  it("shows nothing when there is no announcement, and asks again when main says it changed", async () => {
    const { api, change } = fakeApi({ announcements: [null, "2.0.0"] });
    mount(api, <UpdateNotice />);
    await waitFor(() => expect(api.announcement).toHaveBeenCalledOnce());
    expect(screen.queryByText(/is available/)).toBeNull();
    await act(async () => change());
    expect(await screen.findByText("Pochimail 2.0.0 is available")).toBeTruthy();
  });

  it("renders nothing where no update calls were given", () => {
    mount(undefined, <UpdateNotice />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("Settings › Updates", () => {
  it("is hidden in builds that never check", async () => {
    const { api } = fakeApi({ state: { enabled: false } });
    mount(api, <UpdatesSection />);
    await waitFor(() => expect(api.state).toHaveBeenCalled());
    expect(screen.queryByText("Updates")).toBeNull();
  });

  it("shows the version, and Check now says when the app is up to date", async () => {
    const { api } = fakeApi();
    mount(api, <UpdatesSection />);
    expect(await screen.findByText("Version 1.0.0")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Check now" }));
    expect(await screen.findByText("You are up to date")).toBeTruthy();
  });

  it("offers Download, not an install, when a newer version exists", async () => {
    const { api } = fakeApi({ check: { status: "available", version: "1.4.0" } });
    mount(api, <UpdatesSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Check now" }));
    expect(await screen.findByText("Pochimail 1.4.0 is available")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(api.download).toHaveBeenCalledOnce();
  });

  it("says so when the check failed, and turns the automatic check off and on", async () => {
    const { api } = fakeApi({ check: { status: "failed" } });
    mount(api, <UpdatesSection />);
    await userEvent.click(await screen.findByRole("button", { name: "Check now" }));
    expect(await screen.findByText(/could not check/)).toBeTruthy();
    const toggle = screen.getByRole("switch", { name: "Check for updates automatically" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await userEvent.click(toggle);
    expect(api.setAutoCheck).toHaveBeenLastCalledWith(false);
    await userEvent.click(toggle);
    expect(api.setAutoCheck).toHaveBeenLastCalledWith(true);
  });
});

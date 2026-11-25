// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { NotificationScreen } from "#shared/notifications.ts";
import { createAppRouter } from "../router.tsx";
import { NotificationBridge } from "./notification-bridge.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Guards: a clicked notification that brings the window forward but leaves the page on the wrong screen.
it("opens the screen a clicked notification names and stops listening when unmounted", async () => {
  let listener: ((screen: NotificationScreen) => void) | undefined;
  const stop = vi.fn();
  vi.stubGlobal("pochimail", {
    onOpenScreen: (next: (screen: NotificationScreen) => void) => {
      listener = next;
      return stop;
    },
  });
  const router = createAppRouter(
    { getWorkerClient: () => Promise.reject(new Error("no worker")) },
    { initialEntries: ["/settings"] },
  );
  await router.load();
  const view = render(<NotificationBridge router={router} />);

  listener?.("review");

  await waitFor(() => expect(router.state.location.pathname).toBe("/review"));
  view.unmount();
  expect(stop).toHaveBeenCalledOnce();
});

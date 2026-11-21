// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createRpcClient } from "#shared/ipc/client.ts";
import { serveRpc } from "#shared/ipc/server.ts";
import { fromDomPort } from "#shared/ipc/transport.ts";
import { App } from "../../app/app.tsx";
import { createAppRouter } from "../../router.tsx";
import * as requiredStates from "../states/required-states.tsx";

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("data-animations");
});

const openGallery = async () => {
  const { port1, port2 } = new MessageChannel();
  port1.start();
  port2.start();
  serveRpc(fromDomPort(port2), {
    procedures: {
      "settings.get": () => ({
        autonomy: "suggest" as const,
        capabilities: {
          "catch-what-matters": true,
          declutter: true,
          organize: true,
          "save-documents": true,
        },
        notifications: true,
        theme: "system" as const,
        locale: "en" as const,
      }),
      "settings.update": () => undefined,
    },
    subscriptions: { "app.events": () => undefined, "scan.progress": () => undefined },
  });
  const client = createRpcClient(fromDomPort(port1));
  const router = createAppRouter(
    { getWorkerClient: () => Promise.resolve(client) },
    { initialEntries: ["/gallery"] },
  );
  // The route is a lazy chunk: load it first so the wait below is on rendering, not on a cold module transform (slow on CI).
  await import("./dev-gallery-page.tsx");
  render(<App workerClient={client} router={router} />);
  await screen.findByRole("heading", { level: 1, name: "Dev gallery" });
};

const entries = (kind: "state" | "motion") =>
  [...document.querySelectorAll(`[data-gallery-entry^="${kind}:"]`)].map((el) =>
    el.getAttribute("data-gallery-entry")?.slice(kind.length + 1),
  );

// The catalogs are the source of truth: docs/design.md › Motion catalog (moment names) and the required-states exports.
const designMoments = (): string[] => {
  const doc = readFileSync(
    resolve(import.meta.dirname, "../../../../../../../docs/design.md"),
    "utf8",
  );
  const table = doc.split("## Motion catalog")[1]?.split("\n## ")[0] ?? "";
  return table
    .split("\n")
    .filter((l) => l.startsWith("| ") && !l.startsWith("| Moment") && !l.startsWith("|---"))
    .map((l) => l.split("|")[1]?.trim() ?? "");
};

// Catalog name → gallery entry. A new catalog row or state export fails the test until it is mapped (and so listed).
const momentEntry: Record<string, string> = {
  "Live progress": "LiveProgress",
  "Numbers arrive": "NumbersArrive",
  "Storage settles": "StorageSettles",
  "Clean up, then undo": "CleanUpThenUndo",
  "Pochi at rest": "PochiAtRest",
  "Pochi finds something": "PochiFindsSomething",
  "Summary arrives": "SummarySheet",
  "Choices respond": "ChoicesRespond",
  "Screen to screen": "ScreenToScreen",
  // Panels and menus share the sheet's enter motion (fade + scale/slide from the trigger).
  "Panels and menus": "SummarySheet",
};
const stateEntry: Record<string, string> = {
  SignInCancelledState: "SignInCancelled",
  OfflineStatusLine: "Offline",
  NeedsReconnectState: "NeedsReconnecting",
  ModelDownloadFailedState: "ModelDownloadFailed",
  RateLimitState: "RateLimit",
  EmptyCategoryState: "EmptyCategory",
  NothingToDoState: "NothingToDo",
  UpdateReadyState: "UpdateReady",
};

describe("dev gallery", () => {
  // Guards: a new required state or motion moment that ships without being reviewable (or testable by M4-19) in the app shell.
  it("lists every required state and every motion moment of the catalogs", async () => {
    await openGallery();
    const moments = designMoments();
    expect(moments.length).toBeGreaterThan(0);
    expect(moments.filter((m) => momentEntry[m] === undefined)).toEqual([]);
    expect(entries("motion")).toEqual(expect.arrayContaining(moments.map((m) => momentEntry[m])));
    expect(Object.keys(requiredStates).filter((s) => stateEntry[s] === undefined)).toEqual([]);
    expect(entries("state").sort()).toEqual(
      Object.keys(requiredStates)
        .map((s) => stateEntry[s])
        .sort(),
    );
  });

  // Guards: theme and reduced-motion toggles that do nothing, so reviewers believe they saw dark / instant motion.
  it("the theme and reduced-motion toggles change the rendering", async () => {
    await openGallery();
    const root = document.documentElement;
    expect(root.classList.contains("dark")).toBe(false);
    expect(root.hasAttribute("data-animations")).toBe(false);

    fireEvent.click(screen.getByRole("switch", { name: "Dark theme" }));
    await waitFor(() => expect(root.classList.contains("dark")).toBe(true));

    // Behaviour, not just the attribute: the count-up rolls from 0 with motion on and shows its final value at once with it off.
    const figure = () =>
      document.querySelector(
        '[data-gallery-entry="motion:NumbersArrive"] [data-slot="count-up"] [aria-hidden]',
      )?.textContent;
    expect(figure()).not.toBe("7");
    fireEvent.click(screen.getByRole("switch", { name: "Reduce motion" }));
    await waitFor(() => expect(root.getAttribute("data-animations")).toBe("off"));
    await waitFor(() => expect(figure()).toBe("7"));
  });
});

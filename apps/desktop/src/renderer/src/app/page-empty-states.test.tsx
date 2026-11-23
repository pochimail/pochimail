// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { createRpcClient } from "#shared/ipc/client.ts";
import { serveRpc } from "#shared/ipc/server.ts";
import { fromDomPort } from "#shared/ipc/transport.ts";
import { createAppRouter } from "../router.tsx";
import { App } from "./app.tsx";

afterEach(cleanup);

const setup = (path: string) => {
  const { port1, port2 } = new MessageChannel();
  port1.start();
  port2.start();
  serveRpc(fromDomPort(port2), {
    procedures: {
      "app.state": () => ({ status: "ready" as const, hasConnectedAccount: true }),
      "device.name": () => "device" as const,
      "accounts.list": () => [],
      "mailbox.categories": () => ({
        people: 0,
        records: 0,
        "purchases-travel": 0,
        "sign-ins-security": 0,
        notifications: 0,
        newsletters: 0,
        promotions: 0,
      }),
      "scan.status": () => [],
      "overview.get": () => ({
        scanned: 0,
        toReview: 0,
        waiting: 0,
        deadlines: 0,
        important: 0,
        oldestWaitingDays: 0,
        cleanable: [],
        figures: {
          archived: 0,
          savedCount: 0,
          savedSize: 0,
          deletableSize: 0,
          unsubscribed: 0,
          totalSize: 0,
        },
      }),
      "digest.get": () => ({ ready: false, itemCount: 0 }),
      "settings.get": () => ({
        autonomy: "suggest" as const,
        capabilities: {
          "catch-what-matters": true,
          declutter: true,
          organize: true,
          "save-documents": true,
        },
        notifications: true,
      }),
    },
    subscriptions: {
      "app.events": () => undefined,
      "scan.progress": () => undefined,
    },
  });
  const client = createRpcClient(fromDomPort(port1));
  const router = createAppRouter(
    { getWorkerClient: () => Promise.resolve(client) },
    { initialEntries: [path] },
  );
  render(<App workerClient={client} router={router} />);
  return router;
};

const cases = [
  {
    name: "activity",
    path: "/activity",
    title: "Nothing yet",
    body: "When I archive, delete or unsubscribe for you, it shows up here with an Undo where one is possible.",
    pose: "happy",
  },
  {
    name: "documents",
    path: "/documents",
    title: "Nothing saved yet",
    body: "Documents I save for you will appear here, on this device.",
    pose: "reading",
  },
  {
    name: "category",
    path: "/category/people",
    title: "Nothing to clean here",
    body: "This category is already tidy. I’ll let you know when that changes.",
    pose: "happy",
  },
] as const;

describe("page empty states (issue #189)", () => {
  for (const entry of cases) {
    // Guards: an ad-hoc paragraph with no Pochi, no action or a dead-end action.
    it(`${entry.name}: shows the shared Pochi state with its pose and one working way out`, async () => {
      const router = setup(entry.path);
      const state = await screen.findByRole("status", { name: entry.title });
      expect(state.getAttribute("data-slot")).toBe("empty-state");
      expect(within(state).getByRole("heading", { level: 2, name: entry.title })).toBeTruthy();
      expect(within(state).getByText(entry.body)).toBeTruthy();
      expect(state.querySelector('[data-slot="mascot"]')?.getAttribute("data-pose")).toBe(
        entry.pose,
      );
      const actions = within(state).getAllByRole("button");
      expect(actions).toHaveLength(1);
      expect(actions[0]?.textContent).toBe("Back to overview");
      await userEvent.click(actions[0] as HTMLElement);
      await waitFor(() => expect(router.state.location.pathname).toBe("/overview"));
      expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeTruthy();
    });
  }
});

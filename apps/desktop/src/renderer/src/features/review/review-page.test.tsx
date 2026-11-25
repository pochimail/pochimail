// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createRpcClient } from "#shared/ipc/client.ts";
import type { InputOf, OutputOf } from "#shared/ipc/contract.ts";
import { serveRpc } from "#shared/ipc/server.ts";
import { fromDomPort } from "#shared/ipc/transport.ts";
import { App } from "../../app/app.tsx";
import { createAppRouter } from "../../router.tsx";

afterEach(cleanup);

type Review = OutputOf<"review.get">;

const stored: Review = {
  toReview: 12,
  waiting: 7,
  deadlines: 1,
  important: 4,
  cleanable: [
    { category: "newsletters", count: 300 },
    { category: "notifications", count: 120 },
  ],
  noAccount: true,
};

const setup = () => {
  const { port1, port2 } = new MessageChannel();
  port1.start();
  port2.start();
  const asked: InputOf<"review.get">[] = [];
  serveRpc(fromDomPort(port2), {
    procedures: {
      "accounts.list": () => [{ id: "a1", provider: "google" as const, displayName: "Account" }],
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
      "review.get": (input) => {
        asked.push(input);
        return stored;
      },
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
    { initialEntries: ["/review"] },
  );
  render(<App workerClient={client} router={router} />);
  return { asked, router };
};

describe("review screen (issue #98)", () => {
  // Guards: a Review screen asking for stored mail content, or hiding the connect-an-account note.
  it("shows stored counts and the connect-an-account note when no account is stored", async () => {
    const { asked, router } = setup();
    expect(await screen.findByRole("heading", { level: 1, name: "Review" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/review");

    expect(await screen.findByText("12")).toBeTruthy();
    for (const count of ["7", "1", "4", "300", "120"]) expect(screen.getByText(count)).toBeTruthy();
    expect(screen.getByRole("status")).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Connect an account" })).toBeTruthy();
    expect(
      screen.getByText(
        "These counts are all Pochimail keeps. To list emails, delete or unsubscribe, it needs a connected account: it fetches them from your provider when you ask.",
      ),
    ).toBeTruthy();

    expect(asked).toEqual([{}]);
    expect(JSON.stringify(asked)).not.toMatch(/subject|snippet|sender|body|url/iu);
  });
});

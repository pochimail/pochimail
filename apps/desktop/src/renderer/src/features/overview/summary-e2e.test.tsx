// @vitest-environment jsdom
// Guards: a real first scan leaving the Summary's three slots empty, with no Review CTA or digest date.

import { createGroundTruthClassifier } from "@pochimail/classification/testing/ground-truth-classifier";
import { createLogger } from "@pochimail/logger/logger";
import { createFakeTimer } from "@pochimail/testing/fake-timer";
import { generateMailbox } from "@pochimail/testing/fixture-mailbox/generator";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { createRpcClient } from "#shared/ipc/client.ts";
import { serveRpc } from "#shared/ipc/server.ts";
import { fromDomPort } from "#shared/ipc/transport.ts";
import { DEMO_SEED } from "../../../../shared/demo.ts";
import { createWorkerApp } from "../../../../worker/app.ts";
import { createFixtureAdapters } from "../../../../worker/fixture-adapters.ts";
import { App } from "../../app/app.tsx";
import { createAppRouter } from "../../router.tsx";
import { summaryView } from "./summary-view-model.ts";

afterEach(cleanup);

it("fills the three Summary slots from a real scan without hand-injected figures", async () => {
  const mailbox = generateMailbox({ seed: DEMO_SEED, scale: "small" });
  const labels = new Map(mailbox.labels.messages.map((l) => [l.messageId, l.category] as const));
  let jobs = 0;
  const adapters = await createFixtureAdapters({
    scale: "small",
    timer: createFakeTimer(),
    logger: createLogger({ sink: { write: () => {} } }),
    deviceName: () => "Mac",
    classifier: createGroundTruthClassifier(labels),
    newJobId: () => `job-${++jobs}`,
  });
  const app = createWorkerApp(adapters);
  const { port1, port2 } = new MessageChannel();
  port1.start();
  port2.start();
  serveRpc(fromDomPort(port2), app.handlers);
  const client = createRpcClient(fromDomPort(port1));
  const router = createAppRouter(
    { getWorkerClient: () => Promise.resolve(client) },
    { initialEntries: ["/overview"] },
  );
  render(<App workerClient={client} router={router} />);

  const accountId = mailbox.accounts[0]?.id ?? "";
  await client.call("scan.start", { accountId });
  const dialog = await screen.findByRole("dialog");
  const digest = await client.call("digest.get", { accountId });
  const view = summaryView(digest);

  expect(view.figures.map((figure) => figure.labelKey)).toEqual([
    "summary.figure.archived",
    "summary.figure.saved",
    "summary.figure.unsubscribed",
  ]);
  expect(digest.generatedAt).toBeTypeOf("string");
  for (const label of ["can be archived", "attachments to save", "newsletters to unsubscribe"])
    expect(within(dialog).getByText(label)).toBeTruthy();
  const otherAccount = mailbox.accounts.find((a) => a.id !== accountId)?.id;
  if (otherAccount !== undefined)
    expect(await client.call("digest.get", { accountId: otherAccount })).toMatchObject({
      ready: false,
      itemCount: 0,
    });
  expect(within(dialog).getAllByRole("definition")).toHaveLength(3);
  expect(within(dialog).getByText(/From Pochi · .* · on this Mac/)).toBeTruthy();
  expect(within(dialog).queryByText("Nothing new since the last summary.")).toBeNull();
  expect(
    within(dialog).getByRole("button", { name: `Review ${view.review?.count} emails` }),
  ).toBeTruthy();

  await app.idle();
  port1.close();
  port2.close();
});

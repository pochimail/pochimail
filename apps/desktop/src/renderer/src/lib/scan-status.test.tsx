// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createRpcClient } from "#shared/ipc/client.ts";
import type { EventOf, OutputOf } from "#shared/ipc/contract.ts";
import { serveRpc } from "#shared/ipc/server.ts";
import { fromDomPort } from "#shared/ipc/transport.ts";
import { ScanStatusProvider, useScanStatus } from "./scan-status.tsx";
import { WorkerClientProvider } from "./worker-context.tsx";

afterEach(cleanup);

const Probe = ({ accountIds }: { accountIds: readonly string[] }) => {
  const status = useScanStatus(accountIds);
  return (
    <p data-testid="status">
      {status.active ? "active" : "idle"} {Math.round(status.percent)}% {status.processed}
    </p>
  );
};

const setup = (accountIds: readonly string[]) => {
  const { port1, port2 } = new MessageChannel();
  port1.start();
  port2.start();
  const state = {
    jobs: [] as OutputOf<"scan.status">,
    progress: new Map<string, (event: EventOf<"scan.progress">) => void>(),
  };
  serveRpc(fromDomPort(port2), {
    procedures: {
      "accounts.list": () =>
        accountIds.map((id) => ({ id, provider: "google" as const, displayName: id })),
      "scan.status": () => state.jobs,
    },
    subscriptions: {
      "scan.progress": ({ accountId }, emit) => {
        state.progress.set(accountId, emit);
        return undefined;
      },
    },
  });
  const client = createRpcClient(fromDomPort(port1));
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <WorkerClientProvider client={client}>
        <ScanStatusProvider>
          <Probe accountIds={accountIds} />
        </ScanStatusProvider>
      </WorkerClientProvider>
    </QueryClientProvider>,
  );
  return {
    state,
    queryClient,
    text: () => screen.getByTestId("status").textContent,
    /** The worker's live jobs change, and the shell re-reads them as it does on a progress event. */
    setJobs: async (jobs: OutputOf<"scan.status">) => {
      state.jobs = jobs;
      await queryClient.invalidateQueries({ queryKey: ["scan", "status"] });
    },
    emit: async (accountId: string, event: Omit<EventOf<"scan.progress">, "accountId">) => {
      await waitFor(() => expect(state.progress.has(accountId)).toBe(true));
      state.progress.get(accountId)?.({ accountId, ...event });
    },
  };
};

describe("scan status across two scans of one account", () => {
  it("does not show 100% from the first scan's done event while the second scan has sent nothing yet", async () => {
    // Guards: a rescan (for example Sync now) that starts at the old scan's 100% until its first event.
    const scan = setup(["a1"]);
    await scan.setJobs([{ accountId: "a1", jobId: "j1", status: "running", processed: 0 }]);
    await scan.emit("a1", { phase: "done", processed: 200, total: 200 });
    await waitFor(() => expect(scan.text()).toContain("100%"));
    await scan.setJobs([]);
    await waitFor(() => expect(scan.text()).toContain("idle 100% 200"));

    await scan.setJobs([{ accountId: "a1", jobId: "j2", status: "running", processed: 0 }]);
    await waitFor(() => expect(scan.text()).toBe("active 0% 0"));

    await scan.emit("a1", { phase: "classifying", processed: 20, total: 400 });
    await waitFor(() => expect(scan.text()).toBe("active 5% 20"));
  });

  it("keeps a finished account's count while another account carries on", async () => {
    // Guards: the reset on a new scan taking a finished account out of the sum while others still scan (#276).
    const scan = setup(["a1", "a2"]);
    await scan.setJobs([
      { accountId: "a1", jobId: "j1", status: "running", processed: 0 },
      { accountId: "a2", jobId: "j2", status: "running", processed: 0 },
    ]);
    await scan.emit("a1", { phase: "done", processed: 100, total: 100 });
    await scan.emit("a2", { phase: "classifying", processed: 50, total: 200 });
    await scan.setJobs([{ accountId: "a2", jobId: "j2", status: "running", processed: 50 }]);
    await waitFor(() => expect(scan.text()).toBe("active 50% 150"));
  });
});

import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { createRpcClient } from "../shared/ipc/client.ts";
import { serveRpc } from "../shared/ipc/server.ts";
import { fromDomPort } from "../shared/ipc/transport.ts";
import { acceptPorts } from "../worker/ports.ts";
import { linkWorkerOnEveryLoad } from "./worker-link.ts";

// Guards: after a renderer reload (Cmd+R) the page must get a working worker port again, not stay stuck on "Starting…".
describe("worker connection across page loads", () => {
  it("gives every load a fresh port pair and a worker that serves the newest one", async () => {
    const loads = new EventEmitter();
    const toRenderer: MessagePort[] = [];
    const parent = new EventEmitter();

    // Main side: real linking code with Node MessageChannels standing in for MessageChannelMain.
    linkWorkerOnEveryLoad(
      {
        on: (event: string, listener: () => void) => loads.on(event, listener),
        postMessage: (_channel: string, _msg: unknown, ports: unknown[]) =>
          void toRenderer.push(ports[0] as MessagePort),
      } as never,
      {
        postMessage: (data: unknown, ports: unknown[]) =>
          void parent.emit("message", { data, ports }),
      },
      () => new MessageChannel() as never,
    );
    // Worker side: real port-accepting code serving app.state.
    const workerPorts: MessagePort[] = [];
    acceptPorts(parent as never, (port: MessagePort) => {
      workerPorts.push(port);
      port.start();
      return serveRpc(fromDomPort(port), {
        procedures: {
          "app.state": () => ({
            status: "ready" as const,
            hasConnectedAccount: false,
            needsReauth: [],
          }),
        },
        subscriptions: {},
      });
    });

    loads.emit("did-finish-load");
    // The old page is attached and waiting before the reload, so its CLOSED outcome does not depend on event timing.
    const oldPage = toRenderer[0] as MessagePort;
    oldPage.start();
    const stale = createRpcClient(fromDomPort(oldPage)).call("app.state", ...([] as []));
    const staleOutcome = expect(stale).rejects.toMatchObject({ code: "CLOSED" });
    loads.emit("did-finish-load"); // the reload

    expect(toRenderer).toHaveLength(2);
    const [firstPage, secondPage] = toRenderer as [MessagePort, MessagePort];
    secondPage.start();
    await expect(createRpcClient(fromDomPort(secondPage)).call("app.state")).resolves.toEqual({
      status: "ready",
      hasConnectedAccount: false,
      needsReauth: [],
    });

    await staleOutcome;
    firstPage.close();
    secondPage.close();
    for (const port of workerPorts) port.close();
  });
});

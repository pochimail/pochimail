import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { serveRpc } from "../shared/ipc/server.ts";
import { acceptPorts } from "../worker/ports.ts";
import { acceptStart } from "../worker/start.ts";
import { createSecretVault } from "./secret-vault.ts";
import { linkWorkerOnEveryLoad } from "./worker-link.ts";
import { startWorker } from "./worker-start.ts";

const SECRET = "tok-renderer-must-not-see-9f1c";
const asWorkerPort = (port: MessagePort) => ({
  postMessage: (m: unknown) => port.postMessage(m),
  on: (_event: "message", l: (e: { data: unknown }) => void) =>
    port.addEventListener("message", (e) => l({ data: e.data })),
  start: () => port.start(),
  close: () => port.close(),
});

describe("renderer isolation", () => {
  // Guards: the page ending up with the secrets port (or any port that answers secret requests) through the real
  // main wiring: window link + worker start run together, the page only ever sees what main hands to the WebContents.
  it("a page cannot obtain the secrets port, nor reach any secret procedure", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "pochimail-iso-")), "secrets.json");
    const vault = createSecretVault({
      vault: {
        isAsyncEncryptionAvailable: async () => true,
        encryptStringAsync: async (p) => Buffer.from(p),
        decryptStringAsync: async (c) => ({ result: c.toString(), shouldReEncrypt: false }),
      },
      file: path,
      platform: "darwin",
    });
    await vault.set("refresh-token", SECRET);
    const before = readFileSync(path, "utf8");

    // Worker stand-in: the real accept functions on a fake parent port.
    const parent = new EventEmitter();
    const rendererPorts: unknown[] = [];
    const workerStarts: unknown[] = [];
    acceptPorts({ on: (_e: "message", l: never) => parent.on("message", l) } as never, (port) => {
      rendererPorts.push(port);
      const p = port as ReturnType<typeof asWorkerPort>;
      serveRpc(
        {
          post: (m) => p.postMessage(m),
          onMessage: (h) => p.on("message", (e) => h(e.data)),
          onClose: () => undefined,
          close: () => p.close(),
        },
        { procedures: {}, subscriptions: {} },
      );
      p.start();
    });
    acceptStart({ on: (_e: "message", l: never) => parent.on("message", l) } as never, (start) =>
      workerStarts.push(start),
    );
    const worker = {
      postMessage: (data: unknown, ports: unknown[]) =>
        void parent.emit("message", {
          data,
          ports: ports.map((p) => asWorkerPort(p as MessagePort)),
        }),
    };

    // Main side: the WebContents stand-in records every port it is given.
    const loads = new EventEmitter();
    const pagePorts: MessagePort[] = [];
    linkWorkerOnEveryLoad(
      {
        on: (event: string, l: () => void) => loads.on(event, l),
        postMessage: (_c: string, _m: unknown, ports: unknown[]) =>
          void pagePorts.push(...(ports as MessagePort[])),
      } as never,
      worker,
      () => new MessageChannel() as never,
    );
    startWorker(
      worker,
      vault,
      undefined,
      join(path, "pochimail.db"),
      () => new MessageChannel() as never,
    );
    loads.emit("did-finish-load");

    expect(workerStarts).toHaveLength(1); // the worker holds the secrets client
    expect(rendererPorts).toHaveLength(1); // and exactly one renderer port, not the secrets one
    expect(pagePorts).toHaveLength(1);

    const replies: unknown[] = [];
    for (const port of pagePorts) {
      port.onmessage = (e) => replies.push(e.data);
      for (const [i, op] of ["get", "set", "remove", "protection"].entries())
        port.postMessage({ id: i, op, key: "refresh-token", value: "x" });
    }
    await new Promise((r) => setTimeout(r, 50));
    // The real RPC server rejects secret-shaped messages as malformed: no secret procedure is reachable from the page.
    expect(replies).toHaveLength(4);
    for (const reply of replies)
      expect(reply).toMatchObject({ kind: "failure", error: { code: "BAD_INPUT" } });
    expect(JSON.stringify(replies)).not.toContain(SECRET);
    expect(readFileSync(path, "utf8")).toBe(before);
    for (const port of pagePorts) port.close();
  });
});

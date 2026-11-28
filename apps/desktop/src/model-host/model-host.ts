import { hostControlSchema } from "../shared/model-host-protocol.ts";
import { loadEngine } from "./engine.ts";
import { serveModelHost } from "./serve.ts";

// Runs inside its own Electron utilityProcess (ADR 0002). With no model paths set there is nothing to load: requests are
// answered `unavailable`, except in demo mode, where the fixture stubs answer.
const parent = process.parentPort;
const engine = loadEngine(process.env).catch(() => undefined);

parent.on("message", (event) => {
  const message = hostControlSchema.safeParse(event.data);
  if (!message.success) return;
  if (message.data.type === "ping") {
    parent.postMessage({ type: "pong", n: message.data.n });
    return;
  }
  const port = event.ports[0];
  if (port === undefined) return;
  void engine.then((ready) => {
    serveModelHost(
      {
        post: (reply) => port.postMessage(reply),
        onMessage: (handler) => port.on("message", (portEvent) => handler(portEvent.data)),
        onClose: (handler) => port.on("close", handler),
        close: () => port.close(),
      },
      ready,
    );
    port.start();
  });
});

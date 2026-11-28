import type { MessageChannelMain, MessagePortMain, WebContents } from "electron";

type ChannelPorts = Pick<MessageChannelMain, "port1" | "port2"> & {
  port2: Pick<MessagePortMain, "close">;
};

/** Renderer <-> worker traffic goes over a MessageChannel and never passes through a main handler (ADR 0002). Returns the function that stops linking this worker (it died or was replaced). */
export const linkWorkerOnEveryLoad = (
  contents: Pick<WebContents, "on" | "off" | "postMessage">,
  worker: { postMessage: (message: unknown, transfer: MessagePortMain[]) => void },
  createChannel: () => ChannelPorts,
): (() => void) => {
  let previousRendererPort: Pick<MessagePortMain, "close"> | undefined;
  // A reload destroys the page's port, so each load gets its own channel and the previous one is closed on both ends.
  const link = (): void => {
    if (previousRendererPort) {
      previousRendererPort.close();
      (previousRendererPort as { __pochimailClosed?: boolean }).__pochimailClosed = true;
    }
    const { port1, port2 } = createChannel();
    previousRendererPort = port2;
    worker.postMessage({ type: "port" }, [port1]);
    contents.postMessage("worker-port", null, [port2]);
  };
  contents.on("did-finish-load", link);
  return () => contents.off("did-finish-load", link);
};

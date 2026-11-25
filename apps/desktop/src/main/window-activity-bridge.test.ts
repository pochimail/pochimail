import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { WindowActivityMessage } from "../shared/window-activity-message.ts";
import { bridgeWindowActivityToWorker, windowActivityOf } from "./window-activity-bridge.ts";

/** A stubbed BrowserWindow: the test sets what it is doing and emits the Electron event that follows. */
const stubWindow = () => {
  const events = new EventEmitter();
  const state = { focused: true, visible: true, minimized: false };
  return {
    state,
    events,
    window: {
      isFocused: () => state.focused,
      isVisible: () => state.visible,
      isMinimized: () => state.minimized,
      on: (name: string, listener: () => void) => events.on(name, listener),
      off: (name: string, listener: () => void) => events.off(name, listener),
    },
    emit: (name: string) => events.emit(name),
  };
};

const connect = () => {
  const stub = stubWindow();
  const sent: WindowActivityMessage["state"][] = [];
  const worker = { postMessage: (message: WindowActivityMessage) => void sent.push(message.state) };
  const stop = bridgeWindowActivityToWorker(stub.window as never, worker);
  return { ...stub, sent, worker, stop };
};

describe("window activity from main to the worker", () => {
  it("sends the current state when the worker connects, then each change as the right state, once", () => {
    // Guards: polling at the wrong cadence because the worker was never told, or was told the wrong state.
    const w = connect();
    expect(w.sent).toEqual(["focused"]);

    w.state.focused = false;
    w.emit("blur");
    w.emit("blur");
    w.state.minimized = true;
    w.emit("minimize");
    w.state.minimized = false;
    w.emit("restore");
    w.state.visible = false;
    w.emit("hide");
    w.state.visible = true;
    w.emit("show");
    w.state.focused = true;
    w.emit("focus");
    expect(w.sent).toEqual([
      "focused",
      "visible",
      "hidden",
      "visible",
      "hidden",
      "visible",
      "focused",
    ]);
  });

  it("maps a hidden or minimized window to hidden whatever its focus says", () => {
    // Guards: a window closed to the tray still being polled as if it were in front.
    expect(
      windowActivityOf({ isFocused: () => true, isVisible: () => false, isMinimized: () => false }),
    ).toBe("hidden");
    expect(
      windowActivityOf({ isFocused: () => true, isVisible: () => true, isMinimized: () => true }),
    ).toBe("hidden");
    expect(
      windowActivityOf({ isFocused: () => false, isVisible: () => true, isMinimized: () => false }),
    ).toBe("visible");
  });

  it("sends a restarted worker the current state before anything else", () => {
    // Guards: a worker that restarts and polls at the default cadence while the window is hidden.
    const w = connect();
    w.state.visible = false;
    w.emit("hide");
    const restarted: WindowActivityMessage["state"][] = [];
    bridgeWindowActivityToWorker(w.window as never, {
      postMessage: (message) => void restarted.push(message.state),
    });
    expect(restarted).toEqual(["hidden"]);
  });

  it("stops sending once stopped", () => {
    // Guards: a bridge that keeps posting to a worker that is gone.
    const w = connect();
    w.stop();
    w.state.focused = false;
    w.emit("blur");
    expect(w.sent).toEqual(["focused"]);
  });
});

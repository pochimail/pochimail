import { expect, test } from "@playwright/test";
import { launchApp, loggedProblems } from "./app.ts";

// Guards: the harness (or a later change to it) giving the page Node, which would let mail content reach the machine (ADR 0002).
test("the renderer under test has no Node", async () => {
  const running = await launchApp();
  try {
    const globals = await running.page.evaluate(() => ({
      require: typeof require,
      process: typeof process,
      buffer: typeof Buffer,
      electron: typeof (window as { electron?: unknown }).electron,
    }));
    expect(globals).toEqual({
      require: "undefined",
      process: "undefined",
      buffer: "undefined",
      electron: "undefined",
    });
  } finally {
    await running.close();
  }
});

// Guards: the smoke passing while a screen throws, because nothing listens for errors.
test("an uncaught error in a screen is reported", async () => {
  const running = await launchApp();
  try {
    await running.page.evaluate(() => {
      setTimeout(() => {
        throw new Error("screen failed");
      });
    });
    await expect.poll(() => running.problems).toEqual([expect.stringContaining("screen failed")]);
  } finally {
    await running.close();
  }
});

// Guards: the smoke passing while a screen fails to render, because the boundary's report is not picked up.
test("an error-boundary report is reported", async () => {
  const running = await launchApp();
  try {
    await running.page.evaluate(() => {
      console.error(JSON.stringify({ event: "renderer-error", message: "screen failed" }));
    });
    await expect.poll(() => running.problems).toEqual([expect.stringContaining("screen failed")]);
  } finally {
    await running.close();
  }
});

// Guards: a CSP error logged while a page loads going unreported because the listener was added after the window.
test("a CSP error logged before any listener exists is still reported", async () => {
  const running = await launchApp();
  try {
    const opened = running.app.waitForEvent("window");
    await running.app.evaluate(({ BrowserWindow }) => {
      const window = new BrowserWindow({ show: false });
      const page =
        "<script>console.error('Refused to apply an inline style: Content Security Policy')</script>";
      void window.loadURL(`data:text/html,${encodeURIComponent(page)}`);
    });
    const early = await opened;
    // The buffer holds the message however late it is read.
    await expect.poll(() => loggedProblems(early)).toEqual([expect.stringContaining("csp:")]);
    // A listener added now, as the harness used to do once the window was up, hears nothing: the message is past.
    const late: string[] = [];
    early.on("console", (message) => late.push(message.text()));
    await early.waitForTimeout(200);
    expect(late).toEqual([]);
  } finally {
    await running.close();
  }
});

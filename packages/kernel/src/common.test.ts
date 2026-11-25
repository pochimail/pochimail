// Guards: a cancel source that never fires, fires twice, keeps a removed listener, or stops on a throwing listener.
import { describe, expect, it } from "vitest";
import { createCancelSource } from "./common.ts";

describe("createCancelSource", () => {
  it("abort flips the signal and fires listeners once (guards a pause that never stops work)", () => {
    const { signal, abort } = createCancelSource();
    let calls = 0;
    signal.addEventListener("abort", () => calls++);
    expect(signal.aborted).toBe(false);
    abort();
    abort();
    expect(signal.aborted).toBe(true);
    expect(calls).toBe(1);
  });

  it("a removed listener is not fired (guards leaked handlers after unsubscribe)", () => {
    const { signal, abort } = createCancelSource();
    let calls = 0;
    const listener = () => calls++;
    signal.addEventListener("abort", listener);
    signal.removeEventListener("abort", listener);
    abort();
    expect(calls).toBe(0);
  });

  it("a throwing listener does not prevent later listeners (guards a broken handler blocking cancellation)", () => {
    const { signal, abort } = createCancelSource();
    let later = 0;
    signal.addEventListener("abort", () => {
      throw new Error("listener failed");
    });
    signal.addEventListener("abort", () => later++);
    expect(() => abort()).not.toThrow();
    expect(later).toBe(1);
    expect(signal.aborted).toBe(true);
  });
});

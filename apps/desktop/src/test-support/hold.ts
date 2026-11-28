/** Stops a request of a fake until the test lets it go; an aborted wait ends at once. */
export interface Hold {
  /** Whether a request is waiting at the hold. */
  readonly reached: boolean;
  release(): void;
  wait(signal?: AbortSignal): Promise<void>;
}

export const createHold = (): Hold => {
  let release = () => {};
  let waiting = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    get reached() {
      return waiting > 0;
    },
    release,
    wait: async (signal) => {
      waiting += 1;
      await Promise.race([
        gate,
        new Promise<void>((_, reject) =>
          signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
        ),
      ]);
    },
  };
};

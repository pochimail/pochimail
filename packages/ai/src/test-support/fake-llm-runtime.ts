import type { Generation, LlmRuntime } from "../llm/llm-runtime.ts";

export interface FakeLlmRuntime extends LlmRuntime {
  /** Counts since creation. */
  readonly stats: {
    loads: number;
    disposed: number;
    /** Generations running now and the most that ever ran together. */
    active: number;
    peak: number;
    /** Generations stopped by their signal (their sequence is freed). */
    stopped: number;
  };
  /** Every generation received, in order. */
  readonly generations: readonly Generation[];
  /** The next answers; once empty, `{"answer":"yes"}`. */
  reply(...texts: string[]): void;
  /** Generations wait for `release()`, so a test can cancel or count them while they run. */
  hold(): void;
  release(): void;
  failNextLoad(): void;
  failNextGeneration(): void;
}

export const createFakeLlmRuntime = (): FakeLlmRuntime => {
  const stats = { loads: 0, disposed: 0, active: 0, peak: 0, stopped: 0 };
  const generations: Generation[] = [];
  const replies: string[] = [];
  let gate: Promise<void> | undefined;
  let open: (() => void) | undefined;
  let loadFails = false;
  let generationFails = false;

  return {
    stats,
    generations,
    reply: (...texts) => void replies.push(...texts),
    hold() {
      gate = new Promise((resolve) => {
        open = resolve;
      });
    },
    release() {
      open?.();
      gate = undefined;
    },
    failNextLoad: () => {
      loadFails = true;
    },
    failNextGeneration: () => {
      generationFails = true;
    },
    async load() {
      if (loadFails) {
        loadFails = false;
        throw new Error("load failed");
      }
      stats.loads++;
      return {
        async generate(generation, signal) {
          generations.push(generation);
          stats.active++;
          stats.peak = Math.max(stats.peak, stats.active);
          try {
            if (generationFails) {
              generationFails = false;
              throw new Error("generation failed");
            }
            const stopped = new Promise<"stopped">((resolve) =>
              signal.addEventListener("abort", () => resolve("stopped"), { once: true }),
            );
            if (gate !== undefined && (await Promise.race([gate, stopped])) === "stopped") {
              stats.stopped++;
              return "";
            }
            return replies.shift() ?? '{"answer":"yes"}';
          } finally {
            stats.active--;
          }
        },
        async dispose() {
          stats.disposed++;
        },
      };
    },
  };
};

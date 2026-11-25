import { type Generation, type LlmRuntime, RequestRejected } from "../llm/llm-runtime.ts";

export interface FakeLlmRuntime extends LlmRuntime {
  /** Counts since creation. */
  readonly stats: {
    loads: number;
    disposed: number;
    /** Models loaded and not yet disposed now, and the most that ever were. */
    alive: number;
    peakAlive: number;
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
  /** `load` waits for `releaseLoad()`. */
  holdLoad(): void;
  releaseLoad(): void;
  /** `dispose` waits for `releaseDispose()`. */
  holdDispose(): void;
  releaseDispose(): void;
  failNextLoad(): void;
  failNextGeneration(): void;
  /** The next generation throws `RequestRejected`. */
  rejectNextGeneration(): void;
  /** The next generation ignores its signal and never answers. */
  hangNextGeneration(): void;
}

export const createFakeLlmRuntime = (): FakeLlmRuntime => {
  const stats = { loads: 0, disposed: 0, alive: 0, peakAlive: 0, active: 0, peak: 0, stopped: 0 };
  const generations: Generation[] = [];
  const replies: string[] = [];
  let gate: Promise<void> | undefined;
  let open: (() => void) | undefined;
  let loadFails = false;
  let generationFails = false;
  let rejects = false;
  let hangs = false;
  let loadGate: Promise<void> | undefined;
  let openLoad: (() => void) | undefined;
  let disposeGate: Promise<void> | undefined;
  let openDispose: (() => void) | undefined;

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
    holdLoad() {
      loadGate = new Promise((resolve) => {
        openLoad = resolve;
      });
    },
    releaseLoad() {
      openLoad?.();
      loadGate = undefined;
    },
    holdDispose() {
      disposeGate = new Promise((resolve) => {
        openDispose = resolve;
      });
    },
    releaseDispose() {
      openDispose?.();
      disposeGate = undefined;
    },
    rejectNextGeneration: () => {
      rejects = true;
    },
    hangNextGeneration: () => {
      hangs = true;
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
      await loadGate;
      stats.loads++;
      stats.alive++;
      stats.peakAlive = Math.max(stats.peakAlive, stats.alive);
      return {
        async generate(generation, signal) {
          generations.push(generation);
          stats.active++;
          stats.peak = Math.max(stats.peak, stats.active);
          try {
            if (rejects) {
              rejects = false;
              throw new RequestRejected();
            }
            if (hangs) {
              hangs = false;
              return await new Promise<string>(() => {});
            }
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
          await disposeGate;
          stats.alive--;
          stats.disposed++;
        },
      };
    },
  };
};

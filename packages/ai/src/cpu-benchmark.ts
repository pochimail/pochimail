import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";

const COLS = 2048;
const ROWS = 32_768; // 64 MiB of int8 weights: larger than any cache, like a model
/** Each thread keeps its best round, so a busy moment on a shared machine does not decide the tier. */
const ROUNDS = 3;

/**
 * Converts the kernel's GB/s into the decode speed of the T1 model (tokens per second). Decode streams
 * the whole model per token, so speed follows bandwidth; the factor is fitted on the machines in
 * `packages/ai/bench/results/` (ADR 0019).
 */
const TOKENS_PER_GB_PER_SECOND = 7;

// Inline so the worker needs no file path once the app is bundled. Each thread streams its own rows.
const WORKER = `
const { workerData, parentPort } = require("node:worker_threads");
const { buffer, firstRow, lastRow, budgetMs } = workerData;
const weights = new Int8Array(buffer);
const input = new Int8Array(${COLS});
for (let i = 0; i < ${COLS}; i++) input[i] = (i * 7) & 63;
let best = 0;
let sink = 0;
for (let round = 0; round < ${ROUNDS}; round++) {
  let bytes = 0;
  const start = performance.now();
  while (performance.now() - start < budgetMs / ${ROUNDS}) {
    for (let row = firstRow; row < lastRow; row++) {
      const at = row * ${COLS};
      let a = 0, b = 0, c = 0, d = 0;
      for (let k = 0; k < ${COLS}; k += 4) {
        a += weights[at + k] * input[k];
        b += weights[at + k + 1] * input[k + 1];
        c += weights[at + k + 2] * input[k + 2];
        d += weights[at + k + 3] * input[k + 3];
      }
      sink += a + b + c + d;
    }
    bytes += (lastRow - firstRow) * ${COLS};
  }
  best = Math.max(best, bytes / ((performance.now() - start) / 1000));
}
parentPort.postMessage({ bytesPerSecond: best, sink });
`;

const runThread = (
  buffer: SharedArrayBuffer,
  firstRow: number,
  lastRow: number,
  budgetMs: number,
) =>
  new Promise<number>((resolve, reject) => {
    const worker = new Worker(WORKER, {
      eval: true,
      workerData: { buffer, firstRow, lastRow, budgetMs },
    });
    worker.once("message", (message: { bytesPerSecond: number }) =>
      resolve(message.bytesPerSecond),
    );
    worker.once("error", reject);
    worker.once("exit", (code) => reject(new Error(`benchmark thread exited with ${code}`)));
  });

/**
 * A bounded synthetic stand-in for decoding, with no model: every core streams int8 weights through
 * a dot product for `budgetMs`, in rounds, and keeps the best. Returns the estimated tokens per second of the T1 model on this CPU.
 * Rejects if a thread fails; the caller treats that as "not measured".
 */
export const measureCpuTokensPerSecond = async (budgetMs = 1_500): Promise<number> => {
  const buffer = new SharedArrayBuffer(ROWS * COLS);
  const weights = new Int8Array(buffer);
  for (let i = 0; i < weights.length; i++) weights[i] = (i * 31) & 127;
  const threads = Math.min(availableParallelism(), 16);
  const perThread = Math.floor(ROWS / threads);
  const speeds = await Promise.all(
    Array.from({ length: threads }, (_unused, at) =>
      runThread(buffer, at * perThread, (at + 1) * perThread, budgetMs),
    ),
  );
  const gigabytesPerSecond = speeds.reduce((sum, speed) => sum + speed, 0) / 1e9;
  return Number((gigabytesPerSecond * TOKENS_PER_GB_PER_SECOND).toFixed(1));
};

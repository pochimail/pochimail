import type { Classifier } from "@pochimail/classification/ports/classifier";
import { Cancelled } from "@pochimail/kernel/errors";
import { err } from "@pochimail/kernel/result";
import type { PowerLimiter, PowerLimits } from "@pochimail/pipeline/power-limiter";

/** Batches classified at once: full speed on mains, one at a time on battery (ADR 0006, Speed). */
export const CLASSIFY_LIMITS: PowerLimits = { plugged: 4, battery: 1 };

/** The same classifier, with at most the limiter's number of batches in flight. */
export const limitClassifier = (inner: Classifier, limiter: PowerLimiter): Classifier => ({
  async classify(messages, signal) {
    const release = await limiter.acquire(signal);
    if (!release) return err(new Cancelled());
    try {
      return await inner.classify(messages, signal);
    } finally {
      release();
    }
  },
});

import type { Result } from "./result.ts";

export type AsyncResult<T, E> = Promise<Result<T, E>>;

/** Stops a subscription or a schedule. Safe to call twice. */
export type Unsubscribe = () => void;

/**
 * Structural stand-in for `AbortSignal`: our TypeScript lib has no DOM or Node globals, and a
 * real `AbortSignal` satisfies this shape, so callers pass one unchanged.
 */
export interface CancelSignal {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

/**
 * A cancel source for packages whose TypeScript lib has no DOM or Node globals: `abort()` flips
 * the signal and fires its listeners once. A real `AbortController` satisfies the same contract.
 */
export function createCancelSource(): { signal: CancelSignal; abort: () => void } {
  const listeners = new Set<() => void>();
  const signal: CancelSignal & { aborted: boolean } = {
    aborted: false,
    addEventListener: (_type, listener) => void listeners.add(listener),
    removeEventListener: (_type, listener) => void listeners.delete(listener),
  };
  return {
    signal,
    abort: () => {
      if (signal.aborted) return;
      signal.aborted = true;
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch {
          // A broken listener must not stop the other watches from being cancelled.
        }
      }
    },
  };
}

export interface Page<T> {
  readonly items: readonly T[];
  /** Opaque; `null` when there is nothing more. */
  readonly nextCursor: string | null;
}

export interface PageRequest {
  readonly limit: number;
  readonly cursor?: string;
}

// Exponential backoff helper for EventBridge channel plugin.

export type BackoffState = {
  /** Returns delay in ms and advances internal state. */
  next: () => number;
  /** Resets to initial delay. */
  reset: () => void;
};

/** Creates exponential backoff: base 1s, max 30s, jitter ±20%. */
export function createExponentialBackoff(params?: {
  baseMs?: number;
  maxMs?: number;
  jitterFraction?: number;
}): BackoffState {
  const baseMs = params?.baseMs ?? 1000;
  const maxMs = params?.maxMs ?? 30_000;
  const jitterFraction = params?.jitterFraction ?? 0.2;

  let attempt = 0;

  return {
    next() {
      const raw = Math.min(baseMs * 2 ** attempt, maxMs);
      attempt++;
      const jitter = raw * jitterFraction * (2 * Math.random() - 1);
      return Math.max(0, raw + jitter);
    },
    reset() {
      attempt = 0;
    },
  };
}

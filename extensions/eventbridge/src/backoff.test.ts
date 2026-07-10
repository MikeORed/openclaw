// Backoff helper unit tests.
import { describe, expect, it } from "vitest";
import { createExponentialBackoff } from "./backoff.js";

describe("createExponentialBackoff", () => {
  it("first call returns delay near baseMs (within jitter range)", () => {
    const backoff = createExponentialBackoff({ baseMs: 1000, jitterFraction: 0.2 });
    const delay = backoff.next();
    // First attempt: raw = 1000, jitter ±20% → [800, 1200]
    expect(delay).toBeGreaterThanOrEqual(800);
    expect(delay).toBeLessThanOrEqual(1200);
  });

  it("delays grow exponentially (each within expected bounds)", () => {
    const baseMs = 100;
    const jitterFraction = 0.2;
    const backoff = createExponentialBackoff({ baseMs, maxMs: 100_000, jitterFraction });

    let prev = 0;
    for (let i = 0; i < 5; i++) {
      const delay = backoff.next();
      const raw = baseMs * 2 ** i;
      const lower = raw * (1 - jitterFraction);
      const upper = raw * (1 + jitterFraction);
      expect(delay).toBeGreaterThanOrEqual(lower);
      expect(delay).toBeLessThanOrEqual(upper);
      // Each raw value is >= previous raw, so lower bound grows
      if (i > 0) {
        expect(raw).toBeGreaterThan(prev);
      }
      prev = raw;
    }
  });

  it("delays are capped at maxMs", () => {
    const backoff = createExponentialBackoff({ baseMs: 1000, maxMs: 5000, jitterFraction: 0.2 });
    // Advance well past the cap
    for (let i = 0; i < 20; i++) {
      const delay = backoff.next();
      // maxMs with +20% jitter = 6000 upper bound
      expect(delay).toBeLessThanOrEqual(6000);
    }
  });

  it("reset returns to initial delay", () => {
    const baseMs = 500;
    const jitterFraction = 0.2;
    const backoff = createExponentialBackoff({ baseMs, maxMs: 30_000, jitterFraction });

    // Advance a few times
    backoff.next();
    backoff.next();
    backoff.next();

    // Reset and verify next call is near baseMs again
    backoff.reset();
    const delay = backoff.next();
    const lower = baseMs * (1 - jitterFraction);
    const upper = baseMs * (1 + jitterFraction);
    expect(delay).toBeGreaterThanOrEqual(lower);
    expect(delay).toBeLessThanOrEqual(upper);
  });

  it("respects custom params", () => {
    const backoff = createExponentialBackoff({
      baseMs: 200,
      maxMs: 1000,
      jitterFraction: 0,
    });

    // With zero jitter, delays are deterministic
    expect(backoff.next()).toBe(200); // 200 * 2^0
    expect(backoff.next()).toBe(400); // 200 * 2^1
    expect(backoff.next()).toBe(800); // 200 * 2^2
    expect(backoff.next()).toBe(1000); // capped at maxMs: min(1600, 1000)
    expect(backoff.next()).toBe(1000); // stays capped
  });

  it("uses defaults when no params provided", () => {
    const backoff = createExponentialBackoff();
    const delay = backoff.next();
    // Default: baseMs=1000, jitterFraction=0.2 → [800, 1200]
    expect(delay).toBeGreaterThanOrEqual(800);
    expect(delay).toBeLessThanOrEqual(1200);
  });
});

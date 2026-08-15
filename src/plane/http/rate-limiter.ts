export interface RateLimiterOptions {
  /** Requests permitted per window. */
  limit: number;
  /** Window length in milliseconds. Plane's throttle uses 60s. */
  windowMs?: number;
  /** Injectable clock, for deterministic tests. */
  now?: () => number;
  /** Injectable sleep, for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    // unref so a pending delay never holds the CLI process open.
    const timer = setTimeout(resolve, ms);
    if (typeof timer.unref === 'function') timer.unref();
  });

/**
 * Sliding window rate limiter, shared by every request the client makes.
 *
 * This mirrors how Plane throttles on the server: DRF's SimpleRateThrottle keeps the
 * timestamps of recent requests and admits a new one only when fewer than `limit` fall
 * inside the trailing window. Matching the algorithm rather than approximating it with a
 * fixed delay means we stay under the limit at the boundary between two windows, where a
 * naive "one request every N ms" scheme drifts over.
 *
 * Important: this is per process, and the server counts per API key. Two containers sharing
 * one key will each think they have the full budget. Today only one process runs exports, so
 * the local limiter is sufficient; if that changes, this is the piece that needs to move to
 * a shared Redis token bucket.
 */
export class RateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  /** Grant times inside the current window, oldest first. */
  private readonly grants: number[] = [];

  /**
   * Serialises slot acquisition. Without this, concurrent callers all observe the same
   * "there is room" state and burst straight through the limit.
   */
  private queue: Promise<void> = Promise.resolve();

  /** Set by pauseUntil() when the server tells us to back off. */
  private pausedUntil = 0;

  constructor(options: RateLimiterOptions) {
    if (options.limit < 1) throw new Error('RateLimiter limit must be at least 1');
    this.limit = options.limit;
    this.windowMs = options.windowMs ?? 60_000;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? defaultSleep;
  }

  /** Resolves when the caller may issue its request. */
  acquire(): Promise<void> {
    const slot = this.queue.then(() => this.waitForSlot());
    // Keep the chain alive even if a waiter rejects, so one failure cannot wedge the queue.
    this.queue = slot.then(
      () => undefined,
      () => undefined,
    );
    return slot;
  }

  /**
   * Hold all requests until `timestamp`.
   *
   * Called on a 429 so that a Retry-After applies to every in-flight caller, not just the
   * one that happened to be rejected.
   */
  pauseUntil(timestamp: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, timestamp);
  }

  pauseFor(ms: number): void {
    this.pauseUntil(this.now() + ms);
  }

  /** Slots still available in the current window. Exposed for logging and tests. */
  availableSlots(): number {
    this.evictExpired(this.now());
    return Math.max(0, this.limit - this.grants.length);
  }

  private async waitForSlot(): Promise<void> {
    // Loop rather than compute a single delay: after sleeping, the window may have moved
    // again because another caller was granted a slot in the meantime.
    for (;;) {
      const now = this.now();

      const pauseRemaining = this.pausedUntil - now;
      if (pauseRemaining > 0) {
        await this.sleep(pauseRemaining);
        continue;
      }

      this.evictExpired(now);

      if (this.grants.length < this.limit) {
        this.grants.push(now);
        return;
      }

      // Wait until the oldest grant falls out of the window. +1ms so we wake up strictly
      // after the boundary rather than exactly on it.
      const oldest = this.grants[0] as number;
      await this.sleep(oldest + this.windowMs - now + 1);
    }
  }

  private evictExpired(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.grants.length > 0 && (this.grants[0] as number) <= cutoff) {
      this.grants.shift();
    }
  }
}

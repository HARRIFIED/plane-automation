import { PlaneApiError, PlaneNetworkError, PlaneRateLimitError } from '../errors';

export interface RetryOptions {
  /** Attempts after the first. 0 disables retrying. */
  maxRetries: number;
  /** First backoff delay; doubles each attempt. */
  baseMs: number;
  /** Upper bound on any single backoff. */
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Deterministic jitter source for tests. Returns [0, 1). */
  random?: () => number;
  /** Called before each retry, for logging. */
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer.unref === 'function') timer.unref();
  });

/** 5xx and 408 are transient; 4xx otherwise means the request itself is wrong. */
export function isRetryable(error: unknown): boolean {
  if (error instanceof PlaneRateLimitError) return true;
  if (error instanceof PlaneNetworkError) return true;
  if (error instanceof PlaneApiError) {
    return error.status === undefined || error.status === 408 || error.status >= 500;
  }
  return false;
}

/**
 * Retry with exponential backoff and full jitter.
 *
 * Full jitter (a uniform pick from [0, delay]) rather than fixed backoff, because several
 * projects exporting at once would otherwise retry in lockstep and re-trigger the same 429.
 *
 * A 429 is a special case: the server told us exactly how long to wait, so honour that
 * instead of the computed backoff.
 */
export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const maxDelayMs = options.maxDelayMs ?? 30_000;

  let lastError: unknown;

  for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!isRetryable(error) || attempt === options.maxRetries) throw error;

      const delayMs =
        error instanceof PlaneRateLimitError
          ? error.retryAfterMs
          : Math.round(random() * Math.min(options.baseMs * 2 ** attempt, maxDelayMs));

      options.onRetry?.({ attempt: attempt + 1, delayMs, error });
      await sleep(delayMs);
    }
  }

  throw lastError;
}

/**
 * Parse a Retry-After header, which may be seconds or an HTTP date.
 *
 * Falls back to `fallbackMs` when absent or unparseable, so a server that omits the header
 * still gets a sane backoff rather than an immediate retry.
 */
export function parseRetryAfter(header: string | null, fallbackMs: number, now = Date.now()): number {
  if (!header) return fallbackMs;

  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - now);

  return fallbackMs;
}

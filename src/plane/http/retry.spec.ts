import { PlaneApiError, PlaneNetworkError, PlaneRateLimitError } from '../errors';
import { isRetryable, parseRetryAfter, withRetry } from './retry';

const context = { method: 'GET', path: '/x' };
const noSleep = async (): Promise<void> => undefined;

describe('isRetryable', () => {
  it('retries rate limits, network failures, timeouts and 5xx', () => {
    expect(isRetryable(new PlaneRateLimitError('429', context, 100))).toBe(true);
    expect(isRetryable(new PlaneNetworkError('socket hang up', context))).toBe(true);
    expect(isRetryable(new PlaneApiError('timeout', { ...context, status: 408 }))).toBe(true);
    expect(isRetryable(new PlaneApiError('bad gateway', { ...context, status: 502 }))).toBe(true);
  });

  it('does not retry a request that is simply wrong', () => {
    expect(isRetryable(new PlaneApiError('bad request', { ...context, status: 400 }))).toBe(false);
    expect(isRetryable(new PlaneApiError('forbidden', { ...context, status: 403 }))).toBe(false);
    expect(isRetryable(new Error('boom'))).toBe(false);
  });
});

describe('withRetry', () => {
  it('returns the first successful result without retrying', async () => {
    const operation = jest.fn().mockResolvedValue('ok');

    await expect(withRetry(operation, { maxRetries: 3, baseMs: 10, sleep: noSleep })).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure and succeeds', async () => {
    const operation = jest
      .fn()
      .mockRejectedValueOnce(new PlaneApiError('boom', { ...context, status: 503 }))
      .mockResolvedValue('ok');

    await expect(withRetry(operation, { maxRetries: 3, baseMs: 10, sleep: noSleep })).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('gives up after maxRetries and rethrows the last error', async () => {
    const operation = jest.fn().mockRejectedValue(new PlaneApiError('boom', { ...context, status: 500 }));

    await expect(withRetry(operation, { maxRetries: 2, baseMs: 10, sleep: noSleep })).rejects.toThrow('boom');
    expect(operation).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('does not retry a non-retryable error', async () => {
    const operation = jest.fn().mockRejectedValue(new PlaneApiError('nope', { ...context, status: 400 }));

    await expect(withRetry(operation, { maxRetries: 5, baseMs: 10, sleep: noSleep })).rejects.toThrow('nope');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('backs off exponentially with jitter', async () => {
    const delays: number[] = [];
    const operation = jest.fn().mockRejectedValue(new PlaneApiError('boom', { ...context, status: 500 }));

    await expect(
      withRetry(operation, {
        maxRetries: 3,
        baseMs: 100,
        random: () => 1, // full jitter at its maximum, making the ceiling observable
        sleep: async (ms) => {
          delays.push(ms);
        },
      }),
    ).rejects.toThrow();

    expect(delays).toEqual([100, 200, 400]);
  });

  it('honours the server Retry-After instead of its own backoff on a 429', async () => {
    const delays: number[] = [];
    const operation = jest
      .fn()
      .mockRejectedValueOnce(new PlaneRateLimitError('slow down', context, 7500))
      .mockResolvedValue('ok');

    await withRetry(operation, {
      maxRetries: 3,
      baseMs: 100,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    expect(delays).toEqual([7500]);
  });
});

describe('parseRetryAfter', () => {
  it('reads a delay in seconds', () => {
    expect(parseRetryAfter('30', 500)).toBe(30_000);
  });

  it('reads an HTTP date', () => {
    const now = Date.parse('2026-08-09T12:00:00Z');
    expect(parseRetryAfter('Sun, 09 Aug 2026 12:00:10 GMT', 500, now)).toBe(10_000);
  });

  it('falls back when the header is missing or unparseable', () => {
    expect(parseRetryAfter(null, 500)).toBe(500);
    expect(parseRetryAfter('soon', 500)).toBe(500);
  });

  it('never returns a negative delay for a date already past', () => {
    const now = Date.parse('2026-08-09T12:00:00Z');
    expect(parseRetryAfter('Sun, 09 Aug 2026 11:59:00 GMT', 500, now)).toBe(0);
  });
});

import { RateLimiter } from './rate-limiter';

/**
 * Virtual clock: sleeping advances time instantly, so the tests assert on elapsed virtual
 * milliseconds without actually waiting.
 */
class FakeClock {
  time = 0;

  now = (): number => this.time;

  sleep = async (ms: number): Promise<void> => {
    this.time += ms;
  };
}

describe('RateLimiter', () => {
  it('admits requests up to the limit without delay', async () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter({ limit: 3, windowMs: 1000, now: clock.now, sleep: clock.sleep });

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    expect(clock.time).toBe(0);
  });

  it('delays the request that would exceed the limit until the window slides', async () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter({ limit: 3, windowMs: 1000, now: clock.now, sleep: clock.sleep });

    await Promise.all([
      limiter.acquire(),
      limiter.acquire(),
      limiter.acquire(),
      limiter.acquire(),
      limiter.acquire(),
    ]);

    // The 4th waits out the window; the 5th then fits in the freed space.
    expect(clock.time).toBeGreaterThanOrEqual(1000);
    expect(clock.time).toBeLessThan(2000);
  });

  it('serialises concurrent callers instead of letting them all burst through', async () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter({ limit: 2, windowMs: 1000, now: clock.now, sleep: clock.sleep });

    // Ten concurrent callers at 2 per second: the last one cannot start before ~4 windows.
    await Promise.all(Array.from({ length: 10 }, () => limiter.acquire()));

    expect(clock.time).toBeGreaterThanOrEqual(4000);
  });

  it('holds every caller when the server asks us to back off', async () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter({ limit: 100, windowMs: 1000, now: clock.now, sleep: clock.sleep });

    limiter.pauseFor(5000);
    await limiter.acquire();

    expect(clock.time).toBeGreaterThanOrEqual(5000);
  });

  it('reports remaining slots', async () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter({ limit: 3, windowMs: 1000, now: clock.now, sleep: clock.sleep });

    expect(limiter.availableSlots()).toBe(3);
    await limiter.acquire();
    expect(limiter.availableSlots()).toBe(2);

    clock.time += 1001;
    expect(limiter.availableSlots()).toBe(3);
  });

  it('rejects a nonsensical limit at construction rather than at first use', () => {
    expect(() => new RateLimiter({ limit: 0 })).toThrow(/at least 1/);
  });
});

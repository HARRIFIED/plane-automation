import { MemoryCacheStore } from './memory-cache.store';

describe('MemoryCacheStore', () => {
  it('returns null for a key that was never set', async () => {
    await expect(new MemoryCacheStore().get('missing')).resolves.toBeNull();
  });

  it('round-trips a value', async () => {
    const cache = new MemoryCacheStore();
    await cache.set('key', { states: ['a'] }, 60);

    await expect(cache.get('key')).resolves.toEqual({ states: ['a'] });
  });

  it('expires a value once its TTL has passed', async () => {
    let now = 1_000;
    const cache = new MemoryCacheStore(() => now);

    await cache.set('key', 'value', 60);
    now += 59_000;
    await expect(cache.get('key')).resolves.toBe('value');

    now += 2_000;
    await expect(cache.get('key')).resolves.toBeNull();
  });

  it('deletes a key on demand, which is what a forced refresh relies on', async () => {
    const cache = new MemoryCacheStore();
    await cache.set('key', 'value', 60);
    await cache.delete('key');

    await expect(cache.get('key')).resolves.toBeNull();
  });

  it('keeps keys independent', async () => {
    const cache = new MemoryCacheStore();
    await cache.set('a', 1, 60);
    await cache.set('b', 2, 60);
    await cache.delete('a');

    await expect(cache.get('b')).resolves.toBe(2);
  });
});

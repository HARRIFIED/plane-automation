/**
 * Minimal cache contract.
 *
 * Deliberately small: everything we cache is a JSON-serialisable snapshot with a short TTL,
 * so there is no need for tags, namespaces or partial invalidation. Two implementations exist
 * — Redis when REDIS_URL is set, in-memory otherwise — and callers cannot tell which they have.
 */
export interface CacheStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  /** Human readable name of the backing store, for the boot log. */
  readonly kind: 'redis' | 'memory';
}

export const CACHE_STORE = Symbol('CACHE_STORE');

import { Injectable } from '@nestjs/common';

import type { CacheStore } from './cache.interface';

interface Entry {
  value: unknown;
  expiresAt: number;
}

/**
 * Process-local cache, used when REDIS_URL is unset.
 *
 * Fine for the CLI, where the process exports once and exits. Not fine for more than one
 * service instance: each would keep its own copy and a forced refresh would only clear the
 * one that handled the request. That is why Redis is the deployed configuration.
 */
@Injectable()
export class MemoryCacheStore implements CacheStore {
  readonly kind = 'memory' as const;

  private readonly entries = new Map<string, Entry>();

  constructor(private readonly now: () => number = Date.now) {}

  async get<T>(key: string): Promise<T | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;

    // Expire lazily on read. Nothing here is large enough to need a sweep timer.
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }

    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.entries.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 });
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  /** Test and CLI helper; not part of the CacheStore contract. */
  clear(): void {
    this.entries.clear();
  }
}

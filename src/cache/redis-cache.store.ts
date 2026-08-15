import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

import type { CacheStore } from './cache.interface';

/**
 * Redis backed cache.
 *
 * Every operation is failure tolerant on purpose. The cache holds lookup tables that we can
 * always re-fetch from Plane, so a Redis outage should make exports slower, not broken — a
 * miss and a warning beat a 500 on a report somebody needs. The only cost of degrading is
 * extra requests against the rate limit.
 */
@Injectable()
export class RedisCacheStore implements CacheStore, OnModuleDestroy {
  readonly kind = 'redis' as const;

  private readonly logger = new Logger(RedisCacheStore.name);

  constructor(private readonly client: Redis) {}

  static fromUrl(url: string): RedisCacheStore {
    const client = new Redis(url, {
      // Fail fast rather than queueing commands while Redis is unreachable: a queued command
      // would stall an export behind a connection that may never come back.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 2,
      lazyConnect: false,
    });

    // Without a listener, ioredis connection errors become unhandled 'error' events and take
    // the process down — exactly the opposite of degrading gracefully.
    client.on('error', (error: Error) => {
      new Logger(RedisCacheStore.name).warn(`Redis connection error: ${error.message}`);
    });

    return new RedisCacheStore(client);
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.client.get(key);
      if (raw === null) return null;
      return JSON.parse(raw) as T;
    } catch (error) {
      // Includes malformed JSON from an older cache shape, which should behave as a miss.
      this.logger.warn(`Cache read failed for "${key}", continuing without it: ${describe(error)}`);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      this.logger.warn(`Cache write failed for "${key}": ${describe(error)}`);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (error) {
      this.logger.warn(`Cache delete failed for "${key}": ${describe(error)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

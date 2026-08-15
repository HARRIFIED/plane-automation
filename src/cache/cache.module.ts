import { Global, Logger, Module } from '@nestjs/common';

import { AppConfigService } from '../config';
import { CACHE_STORE } from './cache.interface';
import type { CacheStore } from './cache.interface';
import { MemoryCacheStore } from './memory-cache.store';
import { RedisCacheStore } from './redis-cache.store';

/**
 * Provides whichever cache the environment supports.
 *
 * Redis when REDIS_URL is set, process memory otherwise. The choice is logged at boot so a
 * "why is my forced refresh not taking effect on the other instance" question has an answer
 * in the startup output.
 */
@Global()
@Module({
  providers: [
    {
      provide: CACHE_STORE,
      useFactory: (config: AppConfigService): CacheStore => {
        const logger = new Logger('CacheModule');
        const url = config.redisUrl;

        if (!url) {
          logger.warn('REDIS_URL is not set — using an in-memory lookup cache (single process only)');
          return new MemoryCacheStore();
        }

        logger.log('Using Redis for the lookup cache');
        return RedisCacheStore.fromUrl(url);
      },
      inject: [AppConfigService],
    },
  ],
  exports: [CACHE_STORE],
})
export class CacheModule {}

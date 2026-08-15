import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from './env.schema';

/** Everything the Plane API client needs, grouped so it can be constructed in isolation in tests. */
export interface PlaneClientConfig {
  apiUrl: string;
  appUrl: string;
  apiKey: string;
  workspaceSlug: string;
  rateLimitPerMinute: number;
  pageSize: number;
  maxPages: number;
  requestTimeoutMs: number;
  maxRetries: number;
  retryBaseMs: number;
}

/**
 * Typed access to validated configuration.
 *
 * Prefer this over injecting ConfigService directly: every value here is guaranteed
 * present and correctly typed by the boot-time schema, so no caller needs to handle
 * `undefined` or coerce a string.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  get nodeEnv(): Env['NODE_ENV'] {
    return this.get('NODE_ENV');
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get port(): number {
    return this.get('PORT');
  }

  get plane(): PlaneClientConfig {
    return {
      apiUrl: this.get('PLANE_API_URL'),
      appUrl: this.get('PLANE_APP_URL'),
      apiKey: this.get('PLANE_API_KEY'),
      workspaceSlug: this.get('PLANE_WORKSPACE_SLUG'),
      rateLimitPerMinute: this.get('PLANE_RATE_LIMIT_PER_MINUTE'),
      pageSize: this.get('PLANE_PAGE_SIZE'),
      maxPages: this.get('PLANE_MAX_PAGES'),
      requestTimeoutMs: this.get('PLANE_REQUEST_TIMEOUT_MS'),
      maxRetries: this.get('PLANE_MAX_RETRIES'),
      retryBaseMs: this.get('PLANE_RETRY_BASE_MS'),
    };
  }

  get lookupCacheTtlSeconds(): number {
    return this.get('LOOKUP_CACHE_TTL_SECONDS');
  }

  get databaseUrl(): string | undefined {
    return this.get('DATABASE_URL');
  }

  get redisUrl(): string | undefined {
    return this.get('REDIS_URL');
  }
}

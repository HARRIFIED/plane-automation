import { Controller, Get } from '@nestjs/common';

import { AppConfigService } from '../config';

/**
 * Liveness plus the configuration that is safe to echo.
 *
 * Useful as the first thing to hit after a deploy: it confirms which Plane instance and
 * workspace the service is pointed at, which is the mistake most likely to go unnoticed.
 * The API token is never included.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly config: AppConfigService) {}

  @Get()
  health(): Record<string, unknown> {
    return {
      status: 'ok',
      planeApiUrl: this.config.plane.apiUrl,
      workspace: this.config.plane.workspaceSlug,
      rateLimitPerMinute: this.config.plane.rateLimitPerMinute,
      lookupCacheTtlSeconds: this.config.lookupCacheTtlSeconds,
      cache: this.config.redisUrl ? 'redis' : 'memory',
    };
  }
}

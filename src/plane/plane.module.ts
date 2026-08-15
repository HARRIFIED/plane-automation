import { Module } from '@nestjs/common';

import { AppConfigService } from '../config';
import { PLANE_CONFIG, PLANE_FETCH, PlaneApiClient } from './plane-api.client';
import type { FetchLike } from './plane-api.client';

/**
 * The Plane API client, isolated from everything that consumes it.
 *
 * `fetch` is injected rather than called directly so tests can substitute a fake without
 * patching globals, and so a future swap (proxy, instrumentation) touches one provider.
 */
@Module({
  providers: [
    {
      provide: PLANE_CONFIG,
      useFactory: (config: AppConfigService) => config.plane,
      inject: [AppConfigService],
    },
    {
      // Bound to globalThis so it keeps undici's internal `this`.
      provide: PLANE_FETCH,
      useValue: ((input, init) => globalThis.fetch(input, init)) satisfies FetchLike,
    },
    PlaneApiClient,
  ],
  exports: [PlaneApiClient],
})
export class PlaneModule {}

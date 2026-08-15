import { Global, Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppConfigService } from './app-config.service';
import { validateEnv } from './env.schema';

/**
 * Global configuration module.
 *
 * Exposed as `forRoot()` rather than a plain `@Module` because @nestjs/config validates the
 * environment synchronously inside its own `forRoot`. Calling that in a decorator would run
 * validation as a side effect of *importing* this file — which would make a unit test, or a
 * CLI that only wants a type from this barrel, fail on an unset PLANE_API_KEY.
 *
 * Validation still happens before anything is served: AppModule calls this, so an invalid
 * environment stops the process during bootstrap rather than at the first request.
 */
@Global()
@Module({
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {
  static forRoot(): DynamicModule {
    return {
      module: AppConfigModule,
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          cache: true,
          // .env is for local development only; deployed environments inject real env vars.
          envFilePath: ['.env.local', '.env'],
          validate: validateEnv,
        }),
      ],
    };
  }
}

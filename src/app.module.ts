import { Module } from '@nestjs/common';

import { CacheModule } from './cache';
import { AppConfigModule } from './config';
import { ExportModule } from './export';
import { HttpModule } from './http/http.module';
import { LookupModule } from './lookup';
import { PlaneModule } from './plane';

/**
 * Root module.
 *
 * Used by both entry points: the HTTP server (main.ts) and the CLI, which boots the same
 * graph as an application context so an export behaves identically either way.
 *
 * Still to come: filter presets (step 7).
 */
@Module({
  imports: [AppConfigModule.forRoot(), CacheModule, PlaneModule, LookupModule, ExportModule, HttpModule],
})
export class AppModule {}

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { AppConfigService } from './config';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  // Config is validated during module initialisation, so an invalid environment throws here
  // rather than on the first request.
  const app = await NestFactory.create(AppModule);
  const config = app.get(AppConfigService);

  await app.listen(config.port);

  logger.log(`Listening on port ${config.port} (${config.nodeEnv})`);
  logger.log(`Plane API: ${config.plane.apiUrl} — workspace "${config.plane.workspaceSlug}"`);
  logger.log(`Throttle: ${config.plane.rateLimitPerMinute} requests/minute`);
}

void bootstrap();

import { Module } from '@nestjs/common';

import { ExportModule } from '../export';
import { ExportController } from './export.controller';
import { HealthController } from './health.controller';

@Module({
  imports: [ExportModule],
  controllers: [ExportController, HealthController],
})
export class HttpModule {}

import { Module } from '@nestjs/common';

import { CacheModule } from '../cache';
import { LookupModule } from '../lookup';
import { PlaneModule } from '../plane';
import { ExportService } from './export.service';
import { ProjectResolver } from './project-resolver';

@Module({
  imports: [PlaneModule, LookupModule, CacheModule],
  providers: [ExportService, ProjectResolver],
  exports: [ExportService, ProjectResolver],
})
export class ExportModule {}

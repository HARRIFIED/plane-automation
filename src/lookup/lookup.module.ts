import { Module } from '@nestjs/common';

import { CacheModule } from '../cache';
import { PlaneModule } from '../plane';
import { LookupService } from './lookup.service';

@Module({
  imports: [PlaneModule, CacheModule],
  providers: [LookupService],
  exports: [LookupService],
})
export class LookupModule {}

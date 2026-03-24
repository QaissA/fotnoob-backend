import { Module } from '@nestjs/common';
import { IngestService } from './ingest.service.js';
import { IngestController } from './ingest.controller.js';
import { ProvidersModule } from '../providers/providers.module.js';

@Module({
  imports: [ProvidersModule],
  providers: [IngestService],
  controllers: [IngestController],
})
export class IngestModule {}

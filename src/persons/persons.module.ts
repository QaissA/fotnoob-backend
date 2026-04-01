import { Module } from '@nestjs/common';
import { ProvidersModule } from '../providers/providers.module.js';
import { IngestModule } from '../ingest/ingest.module.js';
import { PersonsController } from './persons.controller.js';
import { PersonsService } from './persons.service.js';

@Module({
  imports: [ProvidersModule, IngestModule],
  controllers: [PersonsController],
  providers: [PersonsService],
})
export class PersonsModule {}

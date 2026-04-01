import { Module } from '@nestjs/common';
import { ProvidersModule } from '../providers/providers.module.js';
import { IngestModule } from '../ingest/ingest.module.js';
import { TeamsController } from './teams.controller.js';
import { TeamsService } from './teams.service.js';

@Module({
  imports: [ProvidersModule, IngestModule],
  controllers: [TeamsController],
  providers: [TeamsService],
})
export class TeamsModule {}

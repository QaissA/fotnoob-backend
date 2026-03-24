import { Module } from '@nestjs/common';
import { FootballDataService } from './football-data/football-data.service.js';
import { IdResolverService } from './normalisation/id-resolver.service.js';

@Module({
  providers: [FootballDataService, IdResolverService],
  exports: [FootballDataService, IdResolverService],
})
export class ProvidersModule {}

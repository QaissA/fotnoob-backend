import { Module } from '@nestjs/common';
import { ScoresController } from './scores.controller.js';
import { ScoresService } from './scores.service.js';
import { ScoresGateway } from './scores.gateway.js';
import { ProvidersModule } from '../providers/providers.module.js';

@Module({
  imports: [ProvidersModule],
  controllers: [ScoresController],
  providers: [ScoresService, ScoresGateway],
  exports: [ScoresService],
})
export class ScoresModule {}

import { Module } from '@nestjs/common';
import { ProvidersModule } from '../providers/providers.module.js';
import { RedisModule } from '../redis/redis.module.js';
import { CompetitionsController } from './competitions.controller.js';
import { PersonsController } from './persons.controller.js';
import { CompetitionsService } from './competitions.service.js';

@Module({
  imports: [ProvidersModule, RedisModule],
  controllers: [CompetitionsController, PersonsController],
  providers: [CompetitionsService],
})
export class CompetitionsModule {}

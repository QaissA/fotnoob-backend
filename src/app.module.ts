import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';

import configuration from './config/configuration.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { ProvidersModule } from './providers/providers.module.js';

import { IngestModule } from './ingest/ingest.module.js';
import { ScoresModule } from './scores/scores.module.js';
import { StatsModule } from './stats/stats.module.js';
import { UserModule } from './user/user.module.js';
import { NewsModule } from './news/news.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { SearchModule } from './search/search.module.js';
import { CompetitionsModule } from './competitions/competitions.module.js';

import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor.js';

@Module({
  imports: [
    // Config — must be first
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env.local', '.env'],
    }),

    // Cron / scheduled tasks
    ScheduleModule.forRoot(),

    // Rate limiting — global guard wired below
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 100,
      },
    ]),

    // Infrastructure (global)
    PrismaModule,
    RedisModule,
    ProvidersModule,

    // Feature modules
    IngestModule,
    UserModule,
    ScoresModule,
    StatsModule,
    NewsModule,
    NotificationsModule,
    SearchModule,
    CompetitionsModule,
  ],
  providers: [
    // Global exception handler
    { provide: APP_FILTER, useClass: HttpExceptionFilter },

    // Global JWT guard — individual endpoints use @Public() to opt out
    { provide: APP_GUARD, useClass: JwtAuthGuard },

    // Global rate-limit guard
    { provide: APP_GUARD, useClass: ThrottlerGuard },

    // Global request/response logger
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule {}

import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import type { AppConfig } from '../config/configuration.js';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  /**
   * Writer client → primary Aurora instance (all mutations).
   * For live match data reads use writer too (avoids ~20ms replica lag).
   */
  readonly writer: PrismaClient;

  /**
   * Reader client → Aurora read replica (slower-changing data: standings, profiles, news).
   */
  readonly reader: PrismaClient;

  constructor(private readonly config: ConfigService<AppConfig>) {
    this.writer = new PrismaClient({
      datasources: {
        db: { url: this.config.get('DB_WRITER_URL', { infer: true }) },
      },
      log: ['warn', 'error'],
    });

    this.reader = new PrismaClient({
      datasources: {
        db: { url: this.config.get('DB_READER_URL', { infer: true }) },
      },
      log: ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await Promise.all([
      this.writer.$connect(),
      this.reader.$connect(),
    ]);
    this.logger.log('Prisma writer + reader connected');
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([
      this.writer.$disconnect(),
      this.reader.$disconnect(),
    ]);
    this.logger.log('Prisma writer + reader disconnected');
  }
}

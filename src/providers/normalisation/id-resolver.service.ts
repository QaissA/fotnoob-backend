import { Injectable, NotFoundException } from '@nestjs/common';
import { LRUCache } from 'lru-cache';
import { PrismaService } from '../../prisma/prisma.service.js';

type EntityType = 'match' | 'team' | 'player' | 'league';

@Injectable()
export class IdResolverService {
  private readonly cache = new LRUCache<string, string>({
    max: 50_000,
    ttl: 1000 * 60 * 60, // 1 hour
  });

  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    entityType: EntityType,
    provider: string,
    externalId: string,
  ): Promise<string> {
    const cacheKey = `${provider}:${entityType}:${externalId}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const row = await this.prisma.reader.externalIdMap.findUnique({
      where: {
        provider_entityType_externalId: { provider, entityType, externalId },
      },
    });

    if (!row) {
      throw new NotFoundException(
        `No ID mapping found for ${provider}/${entityType}/${externalId}`,
      );
    }

    this.cache.set(cacheKey, row.internalId);
    return row.internalId;
  }

  async register(
    entityType: EntityType,
    provider: string,
    externalId: string,
    internalId: string,
  ): Promise<void> {
    await this.prisma.writer.externalIdMap.upsert({
      where: {
        provider_entityType_externalId: { provider, entityType, externalId },
      },
      create: { provider, entityType, externalId, internalId },
      update: { internalId },
    });
    const cacheKey = `${provider}:${entityType}:${externalId}`;
    this.cache.set(cacheKey, internalId);
  }
}

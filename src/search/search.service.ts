import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import type { SearchQuery, SearchResponseDto, SearchResultItemDto } from './dto/search.dto.js';
import type { Prisma } from '@prisma/client';

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async search(query: SearchQuery): Promise<SearchResponseDto> {
    const { q, type } = query;
    const cacheKey = `search:${type}:${q.toLowerCase()}`;

    return this.redis.cachedFetch(cacheKey, 300, async () => {
      const term = q.trim();
      const results: SearchResultItemDto[] = [];

      const containsFilter = (field: string): Prisma.StringFilter => ({
        contains: term,
        mode: 'insensitive',
      });

      const [players, teams, leagues] = await Promise.all([
        type === 'all' || type === 'players'
          ? this.prisma.reader.player.findMany({
              where: { name: containsFilter('name') },
              orderBy: [{ popularityScore: 'desc' }],
              take: 5,
              include: { team: { select: { name: true } } },
            })
          : [],
        type === 'all' || type === 'teams'
          ? this.prisma.reader.team.findMany({
              where: { name: containsFilter('name') },
              take: 5,
            })
          : [],
        type === 'all' || type === 'leagues'
          ? this.prisma.reader.league.findMany({
              where: { name: containsFilter('name'), isActive: true },
              take: 5,
            })
          : [],
      ]);

      for (const p of players) {
        results.push({
          id: p.id,
          name: p.name,
          type: 'player',
          subtitle: p.team?.name ?? p.nationality ?? null,
          imageUrl: p.photoUrl,
        });
      }
      for (const t of teams) {
        results.push({
          id: t.id,
          name: t.name,
          type: 'team',
          subtitle: t.countryCode,
          imageUrl: t.logoUrl,
        });
      }
      for (const l of leagues) {
        results.push({
          id: l.id,
          name: l.name,
          type: 'league',
          subtitle: l.country,
          imageUrl: l.logoUrl,
        });
      }

      return { results, total: results.length };
    });
  }
}

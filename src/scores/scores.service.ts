import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import type {
  MatchesByLeagueDto,
  MatchResponseDto,
} from './dto/get-matches.dto.js';
import type { MatchEventResponseDto } from './dto/match-event.dto.js';
import type { Prisma } from '@prisma/client';

type MatchWithRelations = Prisma.MatchGetPayload<{
  include: {
    homeTeam: { select: { id: true; name: true; shortName: true; logoUrl: true } };
    awayTeam: { select: { id: true; name: true; shortName: true; logoUrl: true } };
    season: { include: { league: { select: { id: true; name: true; logoUrl: true } } } };
  };
}>;

@Injectable()
export class ScoresService {
  private readonly logger = new Logger(ScoresService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async getMatchesByDate(date: string): Promise<MatchesByLeagueDto[]> {
    const today = new Date().toISOString().split('T')[0];
    const isToday = date === today;
    const ttl = isToday ? 30 : 3600;
    const cacheKey = `matches:${date}`;

    return this.redis.cachedFetch(cacheKey, ttl, async () => {
      const matches = await this.prisma.reader.match.findMany({
        where: {
          kickoffTime: {
            gte: new Date(`${date}T00:00:00Z`),
            lt: new Date(`${date}T23:59:59Z`),
          },
        },
        include: {
          homeTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } },
          awayTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } },
          season: { include: { league: { select: { id: true, name: true, logoUrl: true } } } },
        },
        orderBy: [{ kickoffTime: 'asc' }],
      });

      return this.groupByLeague(matches);
    });
  }

  async getMatchById(id: string): Promise<MatchResponseDto> {
    const cacheKey = `match:${id}`;
    const cached = await this.redis.get<MatchResponseDto>(cacheKey);
    if (cached) return cached;

    const match = await this.prisma.writer.match.findUnique({
      where: { id },
      include: {
        homeTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } },
        awayTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } },
        season: { include: { league: { select: { id: true, name: true, logoUrl: true } } } },
      },
    });

    if (!match) throw new NotFoundException(`Match ${id} not found`);

    const dto = this.toMatchDto(match);
    const isLive = match.status === 'LIVE' || match.status === 'HALFTIME';
    await this.redis.set(cacheKey, dto, isLive ? 10 : 3600);
    return dto;
  }

  async getMatchEvents(matchId: string): Promise<MatchEventResponseDto[]> {
    const cacheKey = `match:${matchId}:events`;
    return this.redis.cachedFetch(cacheKey, 15, () =>
      this.prisma.writer.matchEvent.findMany({
        where: { matchId },
        orderBy: [{ minute: 'asc' }],
      }),
    );
  }

  async invalidateMatchCache(matchId: string, date: string): Promise<void> {
    await this.redis.del(
      `matches:${date}`,
      `match:${matchId}`,
      `match:${matchId}:stats`,
      `match:${matchId}:events`,
    );
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private groupByLeague(matches: MatchWithRelations[]): MatchesByLeagueDto[] {
    const leagueMap = new Map<string, MatchesByLeagueDto>();

    for (const match of matches) {
      const league = match.season.league;
      if (!leagueMap.has(league.id)) {
        leagueMap.set(league.id, {
          leagueId: league.id,
          leagueName: league.name,
          logoUrl: league.logoUrl,
          matches: [],
        });
      }
      leagueMap.get(league.id)!.matches.push(this.toMatchDto(match));
    }

    return [...leagueMap.values()];
  }

  private toMatchDto(match: MatchWithRelations): MatchResponseDto {
    return {
      id: match.id,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      status: match.status,
      minute: match.minute,
      kickoffTime: match.kickoffTime.toISOString(),
      venue: match.venue,
      round: match.round,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
    };
  }
}

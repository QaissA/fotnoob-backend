import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { IngestService } from '../ingest/ingest.service.js';
import type {
  MatchesByLeagueDto,
  MatchResponseDto,
} from './dto/get-matches.dto.js';
import type { MatchEventResponseDto } from './dto/match-event.dto.js';
import type { Prisma, MatchStatus } from '@prisma/client';

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
    private readonly ingest: IngestService,
  ) {}

  async getMatchesByDate(date: string): Promise<MatchesByLeagueDto[]> {
    const today = new Date().toISOString().split('T')[0];
    const isToday = date === today;
    const ttl = isToday ? 30 : 3600;
    const cacheKey = `matches:${date}`;

    const cached = await this.redis.get<MatchesByLeagueDto[]>(cacheKey);
    if (cached) return cached;

    const dayStart = new Date(`${date}T00:00:00Z`);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayStart.getUTCDate() + 1);

    let matches = await this.fetchMatchesFromDb(dayStart, dayEnd);

    if (matches.length === 0) {
      this.logger.log(`No matches in DB for ${date} — fetching from external API`);
      try {
        await this.ingest.ingestFixturesForDate(date);
      } catch (err) {
        this.logger.error(`External API fetch failed for ${date}`, err);
        return [];
      }
      matches = await this.fetchMatchesFromDb(dayStart, dayEnd);
      this.logger.log(`Loaded ${matches.length} matches from external API for ${date}`);
    }

    const result = this.groupByLeague(matches);
    if (result.length > 0) {
      await this.redis.set(cacheKey, result, ttl);
    }
    return result;
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

  async getStandingsByCompetition(
    code: string,
    params?: { matchday?: number; season?: number; date?: string },
  ) {
    const seasonName = params?.season ? String(params.season) : null;
    let standings = await this.fetchStandingsFromDb(code, seasonName);

    if (standings.length === 0) {
      this.logger.log(`No standings in DB for ${code} — fetching from external API`);
      try {
        await this.ingest.ingestStandingsForCompetition(code, params);
      } catch (err) {
        this.logger.error(`Failed to ingest standings for ${code}`, err);
        return [];
      }
      standings = await this.fetchStandingsFromDb(code, seasonName);
      this.logger.log(`Loaded ${standings.length} standing entries for ${code}`);
    }

    return standings;
  }

  async getMatchesByCompetition(
    code: string,
    params?: { matchday?: number; status?: string; dateFrom?: string; dateTo?: string },
  ): Promise<MatchesByLeagueDto[]> {
    let matches = await this.fetchCompetitionMatchesFromDb(code, params);

    if (matches.length === 0) {
      this.logger.log(`No matches in DB for competition ${code} — fetching from external API`);
      try {
        await this.ingest.ingestCompetitionMatches(code, params);
      } catch (err) {
        this.logger.error(`Failed to ingest competition matches for ${code}`, err);
        return [];
      }
      matches = await this.fetchCompetitionMatchesFromDb(code, params);
      this.logger.log(`Loaded ${matches.length} matches for competition ${code}`);
    }

    return this.groupByLeague(matches);
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

  private async fetchStandingsFromDb(code: string, seasonName: string | null) {
    return this.prisma.writer.standing.findMany({
      where: {
        season: {
          league: { externalId: code },
          ...(seasonName ? { name: seasonName } : { isCurrent: true }),
        },
      },
      include: {
        team: { select: { id: true, name: true, shortName: true, logoUrl: true } },
      },
      orderBy: { position: 'asc' },
    });
  }

  private async fetchCompetitionMatchesFromDb(
    code: string,
    params?: { matchday?: number; status?: string; dateFrom?: string; dateTo?: string },
  ): Promise<MatchWithRelations[]> {
    const STATUS_MAP: Record<string, string> = {
      SCHEDULED: 'SCHEDULED', TIMED: 'SCHEDULED',
      IN_PLAY: 'LIVE', PAUSED: 'HALFTIME', HALFTIME: 'HALFTIME',
      FINISHED: 'FINISHED', AWARDED: 'FINISHED',
      POSTPONED: 'POSTPONED', SUSPENDED: 'POSTPONED',
      CANCELLED: 'CANCELLED',
    };
    return this.prisma.writer.match.findMany({
      where: {
        season: { league: { externalId: code } },
        ...(params?.dateFrom ? { kickoffTime: { gte: new Date(params.dateFrom) } } : {}),
        ...(params?.dateTo ? { kickoffTime: { lte: new Date(params.dateTo) } } : {}),
        ...(params?.status ? { status: STATUS_MAP[params.status] as MatchStatus } : {}),
        ...(params?.matchday ? { round: `Matchday ${params.matchday}` } : {}),
      },
      include: {
        homeTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } },
        awayTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } },
        season: { include: { league: { select: { id: true, name: true, logoUrl: true } } } },
      },
      orderBy: { kickoffTime: 'asc' },
    });
  }

  private async fetchMatchesFromDb(
    dayStart: Date,
    dayEnd: Date,
  ): Promise<MatchWithRelations[]> {
    return this.prisma.writer.match.findMany({
      where: {
        kickoffTime: {
          gte: dayStart,
          lt: dayEnd,
        },
      },
      include: {
        homeTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } },
        awayTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } },
        season: { include: { league: { select: { id: true, name: true, logoUrl: true } } } },
      },
      orderBy: { kickoffTime: 'asc' },
    });
  }
}

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { IngestService } from '../ingest/ingest.service.js';
import { FootballDataService } from '../providers/football-data/football-data.service.js';
import type { MatchResponseDto } from '../scores/dto/get-matches.dto.js';
import type { TeamDetailDto, TeamSummaryDto, PlayerSummaryDto } from './dto/team.dto.js';
import type { FDTeamMatchFilters } from '../providers/football-data/football-data.types.js';
import type { Prisma, MatchStatus } from '@prisma/client';

const STATUS_MAP: Record<string, string> = {
  SCHEDULED: 'SCHEDULED', TIMED: 'SCHEDULED',
  IN_PLAY: 'LIVE', PAUSED: 'HALFTIME', HALFTIME: 'HALFTIME',
  FINISHED: 'FINISHED', AWARDED: 'FINISHED',
  POSTPONED: 'POSTPONED', SUSPENDED: 'POSTPONED',
  CANCELLED: 'CANCELLED',
};

type MatchWithRelations = Prisma.MatchGetPayload<{
  include: {
    homeTeam: { select: { id: true; name: true; shortName: true; logoUrl: true } };
    awayTeam: { select: { id: true; name: true; shortName: true; logoUrl: true } };
    season: { include: { league: { select: { id: true; name: true; logoUrl: true } } } };
  };
}>;

const MATCH_INCLUDE = {
  homeTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } },
  awayTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } },
  season: { include: { league: { select: { id: true, name: true, logoUrl: true } } } },
} as const;

@Injectable()
export class TeamsService {
  private readonly logger = new Logger(TeamsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly ingest: IngestService,
    private readonly footballData: FootballDataService,
  ) {}

  async getTeamById(id: string): Promise<TeamDetailDto> {
    const cacheKey = `team:${id}`;
    const cached = await this.redis.get<TeamDetailDto>(cacheKey);
    if (cached) return cached;

    const playerSelect = {
      select: { id: true, externalId: true, name: true, position: true, jerseyNumber: true, nationality: true },
    } as const;

    // Accept both internal DB id (cuid) and external football-data.org id (numeric string)
    let team = await this.prisma.reader.team.findFirst({
      where: { OR: [{ id }, { externalId: id }] },
      include: { players: playerSelect },
    });

    // Team exists in DB (from match upserts) but may lack squad — enrich if empty
    if (team && team.players.length === 0) {
      this.logger.log(`Team ${id} in DB but has no squad — enriching from external API`);
      try {
        const fdTeam = await this.footballData.getTeam(parseInt(team.externalId, 10));
        await this.ingest.upsertFullTeam(fdTeam);
        team = await this.prisma.reader.team.findFirst({
          where: { OR: [{ id }, { externalId: id }] },
          include: { players: playerSelect },
        });
      } catch (err) {
        this.logger.error(`Failed to enrich team ${id} from external API`, err);
      }
    }

    // Team not in DB at all — fetch from external API (only works for numeric external IDs)
    if (!team) {
      const numericId = parseInt(id, 10);
      if (isNaN(numericId)) throw new NotFoundException(`Team ${id} not found`);
      this.logger.log(`Team ${id} not in DB — fetching from external API`);
      const fdTeam = await this.footballData.getTeam(numericId);
      await this.ingest.upsertFullTeam(fdTeam);
      team = await this.prisma.reader.team.findFirst({
        where: { OR: [{ id }, { externalId: id }] },
        include: { players: playerSelect },
      });
      if (!team) throw new NotFoundException(`Team ${id} not found`);
    }

    const dto: TeamDetailDto = {
      id: team.id,
      externalId: team.externalId,
      name: team.name,
      shortName: team.shortName,
      logoUrl: team.logoUrl,
      countryCode: team.countryCode,
      founded: team.founded,
      stadium: team.stadium,
      website: team.website,
      squad: team.players.map((p): PlayerSummaryDto => ({
        id: p.id,
        externalId: p.externalId,
        name: p.name,
        position: p.position,
        jerseyNumber: p.jerseyNumber,
        nationality: p.nationality,
      })),
    };

    // Also cache by externalId so both lookup paths hit the cache
    await this.redis.set(cacheKey, dto, 3600);
    await this.redis.set(`team:${team.externalId}`, dto, 3600);
    return dto;
  }

  async listTeams(limit: number, offset: number): Promise<TeamSummaryDto[]> {
    const cacheKey = `teams:list:${limit}:${offset}`;
    const cached = await this.redis.get<TeamSummaryDto[]>(cacheKey);
    if (cached) return cached;

    let teams = await this.prisma.reader.team.findMany({
      skip: offset,
      take: limit,
      orderBy: { name: 'asc' },
      select: { id: true, externalId: true, name: true, shortName: true, logoUrl: true },
    });

    if (teams.length === 0) {
      this.logger.log(`No teams in DB (offset=${offset}) — fetching from external API`);
      const fdTeams = await this.footballData.getTeams({ limit, offset });
      for (const fdTeam of fdTeams) {
        await this.ingest.upsertFullTeam(fdTeam);
      }
      teams = await this.prisma.reader.team.findMany({
        skip: offset,
        take: limit,
        orderBy: { name: 'asc' },
        select: { id: true, externalId: true, name: true, shortName: true, logoUrl: true },
      });
    }

    const result: TeamSummaryDto[] = teams.map((t) => ({
      id: t.id,
      name: t.name,
      shortName: t.shortName,
      logoUrl: t.logoUrl,
    }));

    if (result.length > 0) await this.redis.set(cacheKey, result, 300);
    return result;
  }

  async getTeamMatches(id: string, params: FDTeamMatchFilters): Promise<MatchResponseDto[]> {
    const cacheKey = `team:${id}:matches:${JSON.stringify(params)}`;
    const cached = await this.redis.get<MatchResponseDto[]>(cacheKey);
    if (cached) return cached;

    let matches: MatchWithRelations[] = [];

    // Accept both internal DB id and external football-data.org id
    const team = await this.prisma.reader.team.findFirst({
      where: { OR: [{ id }, { externalId: id }] },
    });

    const buildWhere = (teamId: string): Prisma.MatchWhereInput => {
      const where: Prisma.MatchWhereInput = { OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }] };
      if (params.dateFrom) where.kickoffTime = { ...(where.kickoffTime as object), gte: new Date(params.dateFrom) };
      if (params.dateTo) where.kickoffTime = { ...(where.kickoffTime as object), lte: new Date(params.dateTo) };
      if (params.status) where.status = (STATUS_MAP[params.status] ?? params.status) as MatchStatus;
      return where;
    };

    if (team) {
      matches = await this.prisma.reader.match.findMany({
        where: buildWhere(team.id),
        include: MATCH_INCLUDE,
        orderBy: { kickoffTime: 'desc' },
        take: params.limit ?? 20,
      });
    }

    if (matches.length === 0) {
      // Resolve external ID for the API call
      const extId = team ? parseInt(team.externalId, 10) : parseInt(id, 10);
      if (isNaN(extId)) return [];

      this.logger.log(`No matches in DB for team ${id} — fetching from external API`);
      await this.ingest.syncTeamMatches(extId, params);

      const resolvedTeam = team ?? await this.prisma.reader.team.findFirst({
        where: { OR: [{ id }, { externalId: id }] },
      });
      if (resolvedTeam) {
        matches = await this.prisma.reader.match.findMany({
          where: buildWhere(resolvedTeam.id),
          include: MATCH_INCLUDE,
          orderBy: { kickoffTime: 'desc' },
          take: params.limit ?? 20,
        });
      }
    }

    const result = matches.map((m) => this.toMatchDto(m));
    const hasLive = matches.some((m) => m.status === 'LIVE' || m.status === 'HALFTIME');
    if (result.length > 0) await this.redis.set(cacheKey, result, hasLive ? 30 : 300);
    return result;
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

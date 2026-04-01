import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { IngestService } from '../ingest/ingest.service.js';
import { FootballDataService } from '../providers/football-data/football-data.service.js';
import type { MatchResponseDto } from '../scores/dto/get-matches.dto.js';
import type { PersonDto } from './dto/person.dto.js';
import type { FDPersonMatchFilters } from '../providers/football-data/football-data.types.js';
import type { Prisma } from '@prisma/client';

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
export class PersonsService {
  private readonly logger = new Logger(PersonsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly ingest: IngestService,
    private readonly footballData: FootballDataService,
  ) {}

  async getPersonById(id: string): Promise<PersonDto> {
    const cacheKey = `person:${id}`;
    const cached = await this.redis.get<PersonDto>(cacheKey);
    if (cached) return cached;

    const teamInclude = { team: { select: { id: true, name: true, shortName: true, logoUrl: true } } } as const;

    // Accept both internal DB id (cuid) and external football-data.org id (numeric string)
    let player = await this.prisma.reader.player.findFirst({
      where: { OR: [{ id }, { externalId: id }] },
      include: teamInclude,
    });

    if (!player) {
      const numericId = parseInt(id, 10);
      if (isNaN(numericId)) throw new NotFoundException(`Person ${id} not found`);
      this.logger.log(`Person ${id} not in DB — fetching from external API`);
      const fdPerson = await this.footballData.getPerson(numericId);
      await this.ingest.upsertPerson(fdPerson);
      player = await this.prisma.reader.player.findFirst({
        where: { OR: [{ id }, { externalId: id }] },
        include: teamInclude,
      });
      if (!player) throw new NotFoundException(`Person ${id} not found`);
    }

    const dto: PersonDto = {
      id: player.id,
      externalId: player.externalId,
      name: player.name,
      dateOfBirth: player.dateOfBirth?.toISOString() ?? null,
      nationality: player.nationality,
      position: player.position,
      jerseyNumber: player.jerseyNumber,
      photoUrl: player.photoUrl,
      team: player.team,
    };

    await this.redis.set(cacheKey, dto, 3600);
    await this.redis.set(`person:${player.externalId}`, dto, 3600);
    return dto;
  }

  async getPersonMatches(id: string, params: FDPersonMatchFilters): Promise<MatchResponseDto[]> {
    const cacheKey = `person:${id}:matches:${JSON.stringify(params)}`;
    const cached = await this.redis.get<MatchResponseDto[]>(cacheKey);
    if (cached) return cached;

    let matches: MatchWithRelations[] = [];

    // Accept both internal DB id and external football-data.org id
    const player = await this.prisma.reader.player.findFirst({
      where: { OR: [{ id }, { externalId: id }] },
    });

    if (player) {
      matches = await this.prisma.reader.match.findMany({
        where: { events: { some: { playerId: player.id } } },
        include: MATCH_INCLUDE,
        orderBy: { kickoffTime: 'desc' },
        take: params.limit ?? 20,
      });
    }

    if (matches.length === 0) {
      // Resolve external ID for the API call
      const extId = player ? parseInt(player.externalId, 10) : parseInt(id, 10);
      if (isNaN(extId)) return [];

      this.logger.log(`No matches in DB for person ${id} — fetching from external API`);
      const fdMatches = await this.footballData.getPersonMatches(extId, params);
      for (const m of fdMatches) {
        try {
          await this.ingest.upsertMatch(m);
        } catch (err) {
          this.logger.error(`Failed to upsert match ${m.id}`, err);
        }
      }
      const externalIds = fdMatches.map((m) => String(m.id));
      if (externalIds.length > 0) {
        matches = await this.prisma.reader.match.findMany({
          where: { externalId: { in: externalIds } },
          include: MATCH_INCLUDE,
          orderBy: { kickoffTime: 'desc' },
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

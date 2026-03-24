import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import type {
  MatchStatsResponseDto,
  PlayerRatingDto,
  StandingRowDto,
} from './dto/match-stats.dto.js';

@Injectable()
export class StatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async getMatchStats(matchId: string): Promise<MatchStatsResponseDto> {
    const cacheKey = `match:${matchId}:stats`;
    return this.redis.cachedFetch(cacheKey, 30, async () => {
      const stats = await this.prisma.writer.matchStats.findUnique({
        where: { matchId },
      });
      if (!stats) throw new NotFoundException(`Stats for match ${matchId} not found`);

      return {
        matchId: stats.matchId,
        possession: { home: stats.possessionHome, away: stats.possessionAway },
        shots: { home: stats.shotsHome, away: stats.shotsAway },
        shotsOnTarget: { home: stats.shotsOnTargetHome, away: stats.shotsOnTargetAway },
        xG: { home: stats.xGHome, away: stats.xGAway },
        corners: { home: stats.cornersHome, away: stats.cornersAway },
        fouls: { home: stats.foulsHome, away: stats.foulsAway },
        passAccuracy: { home: stats.passAccuracyHome, away: stats.passAccuracyAway },
        momentumData: stats.momentumData,
      };
    });
  }

  async getPlayerRatings(matchId: string): Promise<PlayerRatingDto[]> {
    const cacheKey = `match:${matchId}:ratings`;
    return this.redis.cachedFetch(cacheKey, 3600, () =>
      this.prisma.reader.playerMatchRating.findMany({
        where: { matchId },
        orderBy: [{ rating: 'desc' }],
      }),
    );
  }

  async getLeagueStandings(leagueId: string): Promise<StandingRowDto[]> {
    const cacheKey = `league:${leagueId}:table`;
    return this.redis.cachedFetch(cacheKey, 60, async () => {
      const rows = await this.prisma.reader.standing.findMany({
        where: { season: { leagueId, isCurrent: true } },
        include: {
          team: { select: { id: true, name: true, shortName: true, logoUrl: true } },
        },
        orderBy: [{ position: 'asc' }],
      });

      return rows.map((r) => ({
        position: r.position,
        teamId: r.teamId,
        teamName: r.team.name,
        teamLogo: r.team.logoUrl,
        played: r.played,
        won: r.won,
        drawn: r.drawn,
        lost: r.lost,
        goalsFor: r.goalsFor,
        goalsAgainst: r.goalsAgainst,
        points: r.points,
        form: r.form,
      }));
    });
  }

  async getTeamForm(teamId: string, limit = 5): Promise<string[]> {
    const matches = await this.prisma.reader.match.findMany({
      where: {
        OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
        status: 'FINISHED',
      },
      orderBy: [{ kickoffTime: 'desc' }],
      take: limit,
    });

    return matches.map((m) => {
      const isHome = m.homeTeamId === teamId;
      const scored = isHome ? m.homeScore : m.awayScore;
      const conceded = isHome ? m.awayScore : m.homeScore;
      if (scored > conceded) return 'W';
      if (scored === conceded) return 'D';
      return 'L';
    });
  }
}

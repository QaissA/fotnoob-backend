import { Injectable } from '@nestjs/common';
import { FootballDataService } from '../providers/football-data/football-data.service.js';
import { RedisService } from '../redis/redis.service.js';
import type { LeagueCode } from '../providers/football-data/league-codes.js';
import type { FDPersonMatchFilters } from '../providers/football-data/football-data.types.js';
import type { CompetitionDetailDto } from './dto/competition.dto.js';
import type { ScorerDto } from './dto/scorer.dto.js';
import type { Head2HeadDto, H2HMatchDto } from './dto/head2head.dto.js';

@Injectable()
export class CompetitionsService {
  constructor(
    private readonly footballData: FootballDataService,
    private readonly redis: RedisService,
  ) {}

  async getCompetition(code: string): Promise<CompetitionDetailDto> {
    return this.redis.cachedFetch(`competition:${code}`, 3600, async () => {
      const comp = await this.footballData.getCompetition(code as LeagueCode);
      return {
        id: comp.id,
        name: comp.name,
        code: comp.code,
        type: comp.type,
        emblem: comp.emblem,
        country: comp.area.name,
        currentMatchday: comp.currentSeason?.currentMatchday ?? null,
      };
    });
  }

  async getTopScorers(code: string, limit = 10, season?: number): Promise<ScorerDto[]> {
    const cacheKey = `competition:${code}:scorers:${limit}:${season ?? 'current'}`;
    return this.redis.cachedFetch(cacheKey, 1800, async () => {
      const scorers = await this.footballData.getCompetitionScorers(
        code as LeagueCode,
        { limit, season },
      );
      return scorers.map((s) => ({
        playerId: s.player.id,
        playerName: s.player.name,
        nationality: s.player.nationality,
        position: s.player.position,
        teamId: s.team.id,
        teamName: s.team.name,
        teamCrest: s.team.crest,
        goals: s.goals,
        assists: s.assists,
        penalties: s.penalties,
        playedMatches: s.playedMatches,
      }));
    });
  }

  async getHead2Head(matchId: number, limit = 10): Promise<Head2HeadDto> {
    return this.redis.cachedFetch(`match:${matchId}:h2h:${limit}`, 3600, async () => {
      const h2h = await this.footballData.getHead2Head(matchId, { limit });
      return {
        numberOfMatches: h2h.aggregates.numberOfMatches,
        totalGoals: h2h.aggregates.totalGoals,
        home: h2h.aggregates.homeTeam,
        away: h2h.aggregates.awayTeam,
        recentMatches: h2h.matches.map((m): H2HMatchDto => ({
          id: m.id,
          utcDate: m.utcDate,
          status: m.status,
          homeTeam: { id: m.homeTeam.id, name: m.homeTeam.name, crest: m.homeTeam.crest },
          awayTeam: { id: m.awayTeam.id, name: m.awayTeam.name, crest: m.awayTeam.crest },
          score: {
            fullTime: m.score.fullTime,
            halfTime: m.score.halfTime,
          },
        })),
      };
    });
  }

  async getPersonMatches(personId: number, params: FDPersonMatchFilters): Promise<H2HMatchDto[]> {
    const cacheKey = `person:${personId}:matches:${JSON.stringify(params)}`;
    return this.redis.cachedFetch(cacheKey, 300, async () => {
      const matches = await this.footballData.getPersonMatches(personId, params);
      return matches.map((m): H2HMatchDto => ({
        id: m.id,
        utcDate: m.utcDate,
        status: m.status,
        homeTeam: { id: m.homeTeam.id, name: m.homeTeam.name, crest: m.homeTeam.crest },
        awayTeam: { id: m.awayTeam.id, name: m.awayTeam.name, crest: m.awayTeam.crest },
        score: {
          fullTime: m.score.fullTime,
          halfTime: m.score.halfTime,
        },
      }));
    });
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import type { MatchStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { FootballDataService } from '../providers/football-data/football-data.service.js';
import type { FDMatch, FDStandingEntry } from '../providers/football-data/football-data.types.js';
import type { LeagueCode } from '../providers/football-data/league-codes.js';

const STATUS_MAP: Record<string, MatchStatus> = {
  SCHEDULED:  'SCHEDULED',
  TIMED:      'SCHEDULED',
  IN_PLAY:    'LIVE',
  PAUSED:     'HALFTIME',
  HALFTIME:   'HALFTIME',
  FINISHED:   'FINISHED',
  AWARDED:    'FINISHED',
  POSTPONED:  'POSTPONED',
  SUSPENDED:  'POSTPONED',
  CANCELLED:  'CANCELLED',
};

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    private readonly footballData: FootballDataService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ─── Job A: Daily fixture sync (3 AM every day) ──────────────────────────

  @Cron('0 3 * * *')
  async syncFixturesByDate(): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    this.logger.log(`Syncing fixtures for ${today} and ${tomorrow}`);
    await Promise.all([
      this.ingestFixturesForDate(today),
      this.ingestFixturesForDate(tomorrow),
    ]);
  }

  async ingestFixturesForDate(date: string): Promise<void> {
    const matches = await this.footballData.getMatchesByDate(date);
    this.logger.debug(`Got ${matches.length} matches for ${date}`);
    for (const match of matches) {
      try {
        await this.upsertMatch(match);
      } catch (err) {
        this.logger.error(`Failed to upsert match ${match.id}`, err);
      }
    }
  }

  // ─── Job B: Live match polling (every 60 s) ───────────────────────────────

  @Interval(60_000)
  async syncLiveMatches(): Promise<void> {
    const liveMatches = await this.footballData.getLiveMatches();
    if (!liveMatches.length) return;

    this.logger.debug(`Polling ${liveMatches.length} live matches`);
    for (const match of liveMatches) {
      try {
        const dbMatch = await this.upsertMatch(match);

        await this.redis.publish('match-events', {
          matchId: dbMatch.id,
          homeScore: dbMatch.homeScore,
          awayScore: dbMatch.awayScore,
          status: dbMatch.status,
        });

        if (dbMatch.status === 'FINISHED') {
          await this.redis.publish('match-finished', { matchId: dbMatch.id });
        }
      } catch (err) {
        this.logger.error(`Failed to sync live match ${match.id}`, err);
      }
    }
  }

  // ─── Job C: Standings sync (4 AM every day) ──────────────────────────────

  @Cron('0 4 * * *')
  async syncStandings(): Promise<void> {
    const activeLeagues = await this.prisma.reader.league.findMany({
      where: { isActive: true },
      include: { seasons: { where: { isCurrent: true } } },
    });

    for (const league of activeLeagues) {
      const season = league.seasons[0];
      if (!season) continue;
      try {
        const table = await this.footballData.getStandings(league.externalId as LeagueCode);
        for (const entry of table) {
          await this.upsertStanding(entry, season.id).catch((err) =>
            this.logger.error(`Failed to upsert standing for team ${entry.team.id}`, err),
          );
        }
        this.logger.debug(`Synced standings for league ${league.name}`);
      } catch (err) {
        this.logger.error(`Failed to sync standings for league ${league.id}`, err);
      }
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async upsertMatch(match: FDMatch) {
    const league = await this.upsertLeague(match);
    const season = await this.upsertSeason(league.id, match.season.startDate.slice(0, 4));
    const homeTeam = await this.upsertTeam(match.homeTeam);
    const awayTeam = await this.upsertTeam(match.awayTeam);

    const round = match.matchday != null ? `Matchday ${match.matchday}` : match.stage;

    return this.prisma.writer.match.upsert({
      where: { externalId: String(match.id) },
      create: {
        externalId: String(match.id),
        seasonId: season.id,
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
        homeScore: match.score.fullTime.home ?? 0,
        awayScore: match.score.fullTime.away ?? 0,
        status: STATUS_MAP[match.status] ?? 'SCHEDULED',
        minute: null,
        kickoffTime: new Date(match.utcDate),
        round,
      },
      update: {
        homeScore: match.score.fullTime.home ?? 0,
        awayScore: match.score.fullTime.away ?? 0,
        status: STATUS_MAP[match.status] ?? 'SCHEDULED',
        minute: null,
        round,
      },
    });
  }

  private async upsertLeague(match: FDMatch) {
    return this.prisma.writer.league.upsert({
      where: { externalId: match.competition.code },
      create: {
        externalId: match.competition.code,
        name: match.competition.name,
        shortName: match.competition.name,
        country: '',
        logoUrl: null,
      },
      update: {
        name: match.competition.name,
      },
    });
  }

  private async upsertSeason(leagueId: string, year: string) {
    const existing = await this.prisma.reader.season.findFirst({
      where: { leagueId, name: year },
    });
    if (existing) return existing;

    try {
      const y = parseInt(year, 10);
      return await this.prisma.writer.season.create({
        data: {
          leagueId,
          name: year,
          startDate: new Date(y, 7, 1),
          endDate: new Date(y + 1, 5, 30),
          isCurrent: true,
        },
      });
    } catch {
      const created = await this.prisma.reader.season.findFirst({ where: { leagueId, name: year } });
      if (!created) throw new Error(`Season ${year} for league ${leagueId} not found after create conflict`);
      return created;
    }
  }

  private async upsertTeam(teamRef: { id: number; name: string; shortName: string; tla: string; crest: string }) {
    return this.prisma.writer.team.upsert({
      where: { externalId: String(teamRef.id) },
      create: {
        externalId: String(teamRef.id),
        name: teamRef.name,
        shortName: teamRef.tla,
        logoUrl: teamRef.crest,
        countryCode: '',
      },
      update: {
        name: teamRef.name,
        shortName: teamRef.tla,
        logoUrl: teamRef.crest,
      },
    });
  }

  private async upsertStanding(entry: FDStandingEntry, seasonId: string) {
    const team = await this.prisma.reader.team.findUnique({
      where: { externalId: String(entry.team.id) },
    });
    if (!team) return;

    await this.prisma.writer.standing.upsert({
      where: { seasonId_teamId: { seasonId, teamId: team.id } },
      create: {
        seasonId,
        teamId: team.id,
        position: entry.position,
        played: entry.playedGames,
        won: entry.won,
        drawn: entry.draw,
        lost: entry.lost,
        goalsFor: entry.goalsFor,
        goalsAgainst: entry.goalsAgainst,
        points: entry.points,
        form: entry.form ?? undefined,
      },
      update: {
        position: entry.position,
        played: entry.playedGames,
        won: entry.won,
        drawn: entry.draw,
        lost: entry.lost,
        goalsFor: entry.goalsFor,
        goalsAgainst: entry.goalsAgainst,
        points: entry.points,
        form: entry.form ?? undefined,
      },
    });
  }
}

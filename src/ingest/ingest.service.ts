import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import type { MatchStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { FootballDataService } from '../providers/football-data/football-data.service.js';
import type { FDMatch, FDStandingEntry, FDScorer, FDTeamMatchFilters } from '../providers/football-data/football-data.types.js';
import type { LeagueCode } from '../providers/football-data/league-codes.js';
import type { AppConfig } from '../config/configuration.js';

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
export class IngestService implements OnModuleInit {
  private readonly logger = new Logger(IngestService.name);
  private schedulingEnabled = true;

  constructor(
    private readonly footballData: FootballDataService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService<AppConfig>,
  ) {}

  onModuleInit(): void {
    const apiKey = this.config.get('FOOTBALL_DATA_API_KEY', { infer: true });
    if (!apiKey || apiKey === 'placeholder') {
      this.schedulingEnabled = false;
      this.logger.warn(
        'FOOTBALL_DATA_API_KEY is not set — scheduled ingest jobs are disabled. Set a real key to enable them.',
      );
    }
  }

  // ─── Job A: Daily fixture sync (3 AM every day) ──────────────────────────

  @Cron('0 3 * * *')
  async syncFixturesByDate(): Promise<void> {
    if (!this.schedulingEnabled) return;
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
    if (!this.schedulingEnabled) return;
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
    if (!this.schedulingEnabled) return;
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

  // ─── Job D: Competition metadata sync (Sunday 2 AM) ──────────────────────

  @Cron('0 2 * * 0')
  async syncCompetitions(): Promise<void> {
    if (!this.schedulingEnabled) return;
    this.logger.log('Syncing competition metadata');
    const competitions = await this.footballData.getCompetitions();

    await this.throttledSequential(competitions, async (comp) => {
      try {
        const detail = await this.footballData.getCompetition(comp.code as LeagueCode);
        await this.prisma.writer.league.upsert({
          where: { externalId: comp.code },
          create: {
            externalId: comp.code,
            name: comp.name,
            shortName: comp.name,
            country: detail.area.name,
            logoUrl: detail.emblem ?? null,
          },
          update: {
            name: comp.name,
            country: detail.area.name,
            logoUrl: detail.emblem ?? null,
          },
        });
        this.logger.debug(`Synced competition ${comp.code}`);
      } catch (err) {
        this.logger.error(`Failed to sync competition ${comp.code}`, err);
      }
    });
  }

  // ─── Job E: Top scorers sync (daily 5 AM) ────────────────────────────────

  @Cron('0 5 * * *')
  async syncTopScorers(): Promise<void> {
    if (!this.schedulingEnabled) return;
    const activeLeagues = await this.prisma.reader.league.findMany({
      where: { isActive: true },
      include: { seasons: { where: { isCurrent: true } } },
    });

    for (const league of activeLeagues) {
      const season = league.seasons[0];
      if (!season) continue;
      try {
        const scorers = await this.footballData.getCompetitionScorers(
          league.externalId as LeagueCode,
          { limit: 10 },
        );
        for (const scorer of scorers) {
          await this.upsertTopScorer(scorer, season.id).catch((err) =>
            this.logger.error(`Failed to upsert scorer ${scorer.player.id}`, err),
          );
        }
        this.logger.debug(`Synced top scorers for league ${league.name}`);
      } catch (err) {
        this.logger.error(`Failed to sync top scorers for league ${league.id}`, err);
      }
    }
  }

  // ─── On-demand: Standings for one competition ────────────────────────────

  async ingestStandingsForCompetition(
    code: string,
    params?: { matchday?: number; season?: number; date?: string },
  ): Promise<void> {
    let league = await this.prisma.reader.league.findUnique({ where: { externalId: code } });
    if (!league) {
      await this.ingestCompetition(code);
      league = await this.prisma.reader.league.findUnique({ where: { externalId: code } });
      if (!league) throw new Error(`League ${code} not found after ingestion`);
    }

    const seasonName = params?.season ? String(params.season) : new Date().getFullYear().toString();
    const season = await this.upsertSeason(league.id, seasonName);

    const table = await this.footballData.getStandings(code as LeagueCode, params);
    this.logger.debug(`Got ${table.length} standing entries for ${code}`);
    for (const entry of table) {
      await this.upsertStanding(entry, season.id).catch((err) =>
        this.logger.error(`Failed to upsert standing for team ${entry.team.id}`, err),
      );
    }
  }

  // ─── On-demand: Matches for one competition ───────────────────────────────

  async ingestCompetitionMatches(
    code: string,
    params?: { matchday?: number; status?: string; dateFrom?: string; dateTo?: string },
  ): Promise<void> {
    const matches = await this.footballData.getCompetitionMatches(code as LeagueCode, params);
    this.logger.debug(`Ingesting ${matches.length} matches for competition ${code}`);
    for (const match of matches) {
      try {
        await this.upsertMatch(match);
      } catch (err) {
        this.logger.error(`Failed to upsert match ${match.id}`, err);
      }
    }
  }

  // ─── On-demand: Single competition ingest ────────────────────────────────

  async ingestCompetition(code: string): Promise<{ externalId: string; name: string; country: string; logoUrl: string | null }> {
    const detail = await this.footballData.getCompetition(code as LeagueCode);
    const league = await this.prisma.writer.league.upsert({
      where: { externalId: code },
      create: {
        externalId: code,
        name: detail.name,
        shortName: detail.name,
        country: detail.area.name,
        logoUrl: detail.emblem ?? null,
      },
      update: {
        name: detail.name,
        country: detail.area.name,
        logoUrl: detail.emblem ?? null,
      },
    });
    this.logger.debug(`Ingested competition ${code}`);
    return { externalId: league.externalId, name: league.name, country: league.country, logoUrl: league.logoUrl };
  }

  // ─── On-demand: Team matches backfill ────────────────────────────────────

  async syncTeamMatches(teamId: number, params?: FDTeamMatchFilters): Promise<number> {
    const matches = await this.footballData.getTeamMatches(teamId, params);
    this.logger.debug(`Backfilling ${matches.length} matches for team ${teamId}`);
    let ingested = 0;
    for (const match of matches) {
      try {
        await this.upsertMatch(match);
        ingested++;
      } catch (err) {
        this.logger.error(`Failed to upsert match ${match.id}`, err);
      }
    }
    return ingested;
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

  private async throttledSequential<T>(
    items: T[],
    fn: (item: T) => Promise<void>,
    delayMs = 6_100,
  ): Promise<void> {
    for (let i = 0; i < items.length; i++) {
      await fn(items[i]);
      if (i < items.length - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  private async upsertTopScorer(scorer: FDScorer, seasonId: string) {
    const team = await this.prisma.reader.team.findUnique({
      where: { externalId: String(scorer.team.id) },
    });
    if (!team) return;

    await this.prisma.writer.topScorer.upsert({
      where: { seasonId_playerId: { seasonId, playerId: String(scorer.player.id) } },
      create: {
        seasonId,
        playerId: String(scorer.player.id),
        teamId: team.id,
        goals: scorer.goals,
        assists: scorer.assists ?? undefined,
        penalties: scorer.penalties ?? undefined,
        playedGames: scorer.playedMatches,
      },
      update: {
        teamId: team.id,
        goals: scorer.goals,
        assists: scorer.assists ?? undefined,
        penalties: scorer.penalties ?? undefined,
        playedGames: scorer.playedMatches,
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

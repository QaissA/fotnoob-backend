import { Injectable, Logger } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import type { MatchStatus, EventType } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { FootballDataService } from '../providers/football-data/football-data.service.js';
import type {
  ApiFootballFixture,
  ApiFootballTeam,
  ApiFootballStanding,
  ApiFootballFixtureStatistic,
  ApiFootballFixturePlayer,
} from '../providers/football-data/football-data.types.js';

const STATUS_MAP: Record<string, MatchStatus> = {
  NS: 'SCHEDULED',
  '1H': 'LIVE',
  HT: 'HALFTIME',
  '2H': 'LIVE',
  ET: 'LIVE',
  BT: 'LIVE',
  P: 'LIVE',
  FT: 'FINISHED',
  AET: 'FINISHED',
  PEN: 'FINISHED',
  PST: 'POSTPONED',
  CANC: 'CANCELLED',
  SUSP: 'POSTPONED',
  ABD: 'CANCELLED',
  AWD: 'FINISHED',
  WO: 'FINISHED',
};

function mapEventType(type: string, detail: string): EventType | null {
  if (type === 'Goal') {
    if (detail === 'Own Goal') return 'OWN_GOAL';
    if (detail === 'Missed Penalty') return 'PENALTY_MISSED';
    if (detail === 'Penalty') return 'PENALTY_SCORED';
    return 'GOAL';
  }
  if (type === 'Card') {
    if (detail === 'Yellow Card') return 'YELLOW_CARD';
    if (detail === 'Red Card') return 'RED_CARD';
    return null;
  }
  if (type === 'subst') return 'SUBSTITUTION';
  if (type === 'Var') return 'VAR_REVIEW';
  return null;
}

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
    const fixtures = await this.footballData.getFixturesByDate(date);
    this.logger.debug(`Got ${fixtures.length} fixtures for ${date}`);
    for (const fixture of fixtures) {
      try {
        await this.upsertFixture(fixture);
      } catch (err) {
        this.logger.error(`Failed to upsert fixture ${fixture.fixture.id}`, err);
      }
    }
  }

  // ─── Job B: Live match polling (every 60 s) ───────────────────────────────

  @Interval(60_000)
  async syncLiveMatches(): Promise<void> {
    const liveFixtures = await this.footballData.getLiveFixtures();
    if (!liveFixtures.length) return;

    this.logger.debug(`Polling events for ${liveFixtures.length} live matches`);
    for (const fixture of liveFixtures) {
      try {
        const match = await this.upsertFixture(fixture);
        await this.syncMatchEvents(
          fixture.fixture.id,
          match.id,
          match.homeScore,
          match.awayScore,
          match.status,
          String(fixture.teams.home.id),
          String(fixture.teams.away.id),
        );
      } catch (err) {
        this.logger.error(`Failed to sync live fixture ${fixture.fixture.id}`, err);
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
        const year = parseInt(season.name, 10);
        const standingsGroups = await this.footballData.getStandings(
          parseInt(league.externalId, 10),
          year,
        );
        for (const group of standingsGroups) {
          for (const entry of group) {
            await this.upsertStanding(entry, season.id).catch((err) =>
              this.logger.error(`Failed to upsert standing for team ${entry.team.id}`, err),
            );
          }
        }
        this.logger.debug(`Synced standings for league ${league.name} (${year})`);
      } catch (err) {
        this.logger.error(`Failed to sync standings for league ${league.id}`, err);
      }
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async upsertFixture(fixture: ApiFootballFixture) {
    const league = await this.upsertLeague(fixture);
    const season = await this.upsertSeason(league.id, fixture.league.season);
    const homeTeam = await this.upsertTeam(fixture.teams.home, fixture.league.country);
    const awayTeam = await this.upsertTeam(fixture.teams.away, fixture.league.country);

    return this.prisma.writer.match.upsert({
      where: { externalId: String(fixture.fixture.id) },
      create: {
        externalId: String(fixture.fixture.id),
        seasonId: season.id,
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
        homeScore: fixture.goals.home ?? 0,
        awayScore: fixture.goals.away ?? 0,
        status: STATUS_MAP[fixture.fixture.status.short] ?? 'SCHEDULED',
        minute: fixture.fixture.status.elapsed ?? null,
        kickoffTime: new Date(fixture.fixture.date),
        venue: fixture.fixture.venue.name ?? undefined,
        round: fixture.league.round,
      },
      update: {
        homeScore: fixture.goals.home ?? 0,
        awayScore: fixture.goals.away ?? 0,
        status: STATUS_MAP[fixture.fixture.status.short] ?? 'SCHEDULED',
        minute: fixture.fixture.status.elapsed ?? null,
        venue: fixture.fixture.venue.name ?? undefined,
        round: fixture.league.round,
      },
    });
  }

  private async syncMatchEvents(
    externalFixtureId: number,
    internalMatchId: string,
    currentHomeScore: number,
    currentAwayScore: number,
    currentStatus: MatchStatus,
    homeTeamExternalId: string,
    awayTeamExternalId: string,
  ): Promise<void> {
    const events = await this.footballData.getFixtureEvents(externalFixtureId);

    for (const event of events) {
      const team = await this.prisma.reader.team.findUnique({
        where: { externalId: String(event.team.id) },
      });
      if (!team) continue;

      const type = mapEventType(event.type, event.detail);
      if (!type) continue;

      const player = await this.upsertMinimalPlayer(event.player.id, event.player.name, team.id);

      let assistPlayerId: string | undefined;
      if (event.assist.id) {
        const assist = await this.upsertMinimalPlayer(
          event.assist.id,
          event.assist.name ?? '',
          team.id,
        );
        assistPlayerId = assist.id;
      }

      const externalEventId = `${externalFixtureId}-${event.time.elapsed}-${event.player.id}`;
      await this.prisma.writer.matchEvent.upsert({
        where: { externalId: externalEventId },
        create: {
          externalId: externalEventId,
          matchId: internalMatchId,
          type,
          minute: event.time.elapsed,
          addedTime: event.time.extra ?? undefined,
          teamId: team.id,
          playerId: player.id,
          assistPlayerId,
          detail: event.detail,
        },
        update: {
          detail: event.detail,
          addedTime: event.time.extra ?? undefined,
        },
      });
    }

    // Fan out current match state to WebSocket clients via Redis pub/sub
    await this.redis.publish('match-events', {
      matchId: internalMatchId,
      homeScore: currentHomeScore,
      awayScore: currentAwayScore,
      status: currentStatus,
    });

    // Notify when a match finishes
    if (currentStatus === 'FINISHED') {
      await this.redis.publish('match-finished', { matchId: internalMatchId });
      await this.syncMatchStats(externalFixtureId, internalMatchId, homeTeamExternalId, awayTeamExternalId).catch(
        (err) => this.logger.error(`Failed to sync stats for fixture ${externalFixtureId}`, err),
      );
    }
  }

  private async syncMatchStats(
    externalFixtureId: number,
    internalMatchId: string,
    homeTeamExternalId: string,
    awayTeamExternalId: string,
  ): Promise<void> {
    const [statsData, playersData] = await Promise.all([
      this.footballData.getFixtureStatistics(externalFixtureId),
      this.footballData.getFixturePlayers(externalFixtureId),
    ]);

    // ─── MatchStats upsert ──────────────────────────────────────────────────

    const findStat = (
      stats: ApiFootballFixtureStatistic['statistics'],
      type: string,
    ): string | number | null => stats.find((s) => s.type === type)?.value ?? null;

    const parsePct = (v: string | number | null): number | null =>
      v !== null ? parseFloat(String(v)) : null;

    const parseNum = (v: string | number | null): number | null =>
      typeof v === 'number' ? v : v !== null ? parseInt(String(v), 10) : null;

    const homeStats = statsData.find((s) => String(s.team.id) === homeTeamExternalId)?.statistics ?? [];
    const awayStats = statsData.find((s) => String(s.team.id) === awayTeamExternalId)?.statistics ?? [];

    const mappedStats = {
      possessionHome: parsePct(findStat(homeStats, 'Ball Possession')),
      possessionAway: parsePct(findStat(awayStats, 'Ball Possession')),
      shotsHome: parseNum(findStat(homeStats, 'Total Shots')),
      shotsAway: parseNum(findStat(awayStats, 'Total Shots')),
      shotsOnTargetHome: parseNum(findStat(homeStats, 'Shots on Goal')),
      shotsOnTargetAway: parseNum(findStat(awayStats, 'Shots on Goal')),
      cornersHome: parseNum(findStat(homeStats, 'Corner Kicks')),
      cornersAway: parseNum(findStat(awayStats, 'Corner Kicks')),
      foulsHome: parseNum(findStat(homeStats, 'Fouls')),
      foulsAway: parseNum(findStat(awayStats, 'Fouls')),
      passAccuracyHome: parsePct(findStat(homeStats, 'Passes %')),
      passAccuracyAway: parsePct(findStat(awayStats, 'Passes %')),
      xGHome: parsePct(findStat(homeStats, 'expected_goals')),
      xGAway: parsePct(findStat(awayStats, 'expected_goals')),
    };

    await this.prisma.writer.matchStats.upsert({
      where: { matchId: internalMatchId },
      create: { matchId: internalMatchId, ...mappedStats },
      update: mappedStats,
    });

    // ─── PlayerMatchRating upserts ──────────────────────────────────────────

    for (const teamEntry of playersData) {
      const team = await this.prisma.reader.team.findUnique({
        where: { externalId: String(teamEntry.team.id) },
      });
      if (!team) continue;

      for (const { player, statistics } of teamEntry.players) {
        const stat = statistics[0];
        if (!stat?.games.minutes) continue; // skip unused substitutes

        const rating = stat.games.rating ? parseFloat(stat.games.rating) : null;
        if (rating === null) continue;

        const internalPlayer = await this.upsertMinimalPlayer(player.id, player.name, team.id);

        await this.prisma.writer.playerMatchRating.upsert({
          where: { playerId_matchId: { playerId: internalPlayer.id, matchId: internalMatchId } },
          create: {
            playerId: internalPlayer.id,
            matchId: internalMatchId,
            rating,
            minutes: stat.games.minutes,
            goals: stat.goals.total ?? 0,
            assists: stat.goals.assists ?? 0,
          },
          update: {
            rating,
            minutes: stat.games.minutes,
            goals: stat.goals.total ?? 0,
            assists: stat.goals.assists ?? 0,
          },
        });
      }
    }
  }

  private async upsertLeague(fixture: ApiFootballFixture) {
    return this.prisma.writer.league.upsert({
      where: { externalId: String(fixture.league.id) },
      create: {
        externalId: String(fixture.league.id),
        name: fixture.league.name,
        shortName: fixture.league.name,
        country: fixture.league.country,
        logoUrl: fixture.league.logo,
      },
      update: {
        name: fixture.league.name,
        logoUrl: fixture.league.logo,
      },
    });
  }

  private async upsertSeason(leagueId: string, year: number) {
    const name = String(year);
    const existing = await this.prisma.reader.season.findFirst({
      where: { leagueId, name },
    });
    if (existing) return existing;

    try {
      return await this.prisma.writer.season.create({
        data: {
          leagueId,
          name,
          startDate: new Date(year, 7, 1),    // Aug 1 of season year
          endDate: new Date(year + 1, 5, 30), // Jun 30 of following year
          isCurrent: true,
        },
      });
    } catch {
      // Handle race condition: another concurrent job created the same season
      const created = await this.prisma.reader.season.findFirst({ where: { leagueId, name } });
      if (!created) throw new Error(`Season ${name} for league ${leagueId} not found after create conflict`);
      return created;
    }
  }

  private async upsertTeam(apiTeam: ApiFootballTeam, country: string) {
    return this.prisma.writer.team.upsert({
      where: { externalId: String(apiTeam.id) },
      create: {
        externalId: String(apiTeam.id),
        name: apiTeam.name,
        shortName: apiTeam.name,
        logoUrl: apiTeam.logo,
        countryCode: country,
      },
      update: {
        name: apiTeam.name,
        logoUrl: apiTeam.logo,
      },
    });
  }

  private async upsertMinimalPlayer(externalId: number, name: string, teamId: string) {
    return this.prisma.writer.player.upsert({
      where: { externalId: String(externalId) },
      create: {
        externalId: String(externalId),
        name,
        teamId,
      },
      update: { name },
    });
  }

  private async upsertStanding(entry: ApiFootballStanding, seasonId: string) {
    const team = await this.prisma.reader.team.findUnique({
      where: { externalId: String(entry.team.id) },
    });
    if (!team) return;

    await this.prisma.writer.standing.upsert({
      where: { seasonId_teamId: { seasonId, teamId: team.id } },
      create: {
        seasonId,
        teamId: team.id,
        position: entry.rank,
        played: entry.all.played,
        won: entry.all.win,
        drawn: entry.all.draw,
        lost: entry.all.lose,
        goalsFor: entry.all.goals.for,
        goalsAgainst: entry.all.goals.against,
        points: entry.points,
        form: entry.form,
      },
      update: {
        position: entry.rank,
        played: entry.all.played,
        won: entry.all.win,
        drawn: entry.all.draw,
        lost: entry.all.lose,
        goalsFor: entry.all.goals.for,
        goalsAgainst: entry.all.goals.against,
        points: entry.points,
        form: entry.form,
      },
    });
  }
}

import type { MatchStatus, EventType } from '@prisma/client';
import type {
  ApiFootballFixture,
  ApiFootballEvent,
} from './football-data.types.js';
import type { CanonicalMatch, CanonicalEvent } from '../normalisation/canonical.types.js';

const PROVIDER = 'api-football';

// ─── Status mapping ─────────────────────────────────────────────────────────

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

// ─── Event type mapping ──────────────────────────────────────────────────────

function mapEventType(
  type: string,
  detail: string,
): EventType | null {
  if (type === 'Goal') {
    if (detail === 'Own Goal') return 'OWN_GOAL';
    if (detail === 'Missed Penalty') return 'PENALTY_MISSED';
    if (detail === 'Penalty') return 'PENALTY_SCORED';
    return 'GOAL';
  }
  if (type === 'Card') {
    if (detail === 'Yellow Card') return 'YELLOW_CARD';
    if (detail === 'Red Card') return 'RED_CARD';
    if (detail === 'Yellow Card') return 'YELLOW_CARD';
    return null;
  }
  if (type === 'subst') return 'SUBSTITUTION';
  if (type === 'Var') return 'VAR_REVIEW';
  return null;
}

// ─── Fixture → CanonicalMatch ────────────────────────────────────────────────

export function normaliseFixture(
  fixture: ApiFootballFixture,
  internalMatchId: string,
  internalHomeTeamId: string,
  internalAwayTeamId: string,
  internalSeasonId: string,
  internalLeagueId: string,
): CanonicalMatch {
  return {
    internalId: internalMatchId,
    externalIds: { [PROVIDER]: String(fixture.fixture.id) },
    leagueId: internalLeagueId,
    seasonId: internalSeasonId,
    homeTeamId: internalHomeTeamId,
    awayTeamId: internalAwayTeamId,
    homeScore: fixture.goals.home ?? 0,
    awayScore: fixture.goals.away ?? 0,
    status: STATUS_MAP[fixture.fixture.status.short] ?? 'SCHEDULED',
    minute: fixture.fixture.status.elapsed ?? null,
    kickoffTime: new Date(fixture.fixture.date),
    venue: fixture.fixture.venue.name ?? '',
    round: fixture.league.round,
  };
}

// ─── Event → CanonicalEvent ──────────────────────────────────────────────────

export function normaliseEvent(
  event: ApiFootballEvent,
  fixtureId: number,
  internalMatchId: string,
  internalTeamId: string,
  internalPlayerId: string,
  internalAssistId?: string,
): CanonicalEvent | null {
  const type = mapEventType(event.type, event.detail);
  if (!type) return null;

  return {
    internalId: `af-${fixtureId}-${event.time.elapsed}-${internalPlayerId}`,
    externalId: `${fixtureId}-${event.time.elapsed}-${event.player.id}`,
    matchId: internalMatchId,
    type,
    minute: event.time.elapsed,
    addedTime: event.time.extra ?? undefined,
    teamId: internalTeamId,
    playerId: internalPlayerId,
    assistPlayerId: internalAssistId,
    detail: event.detail,
  };
}

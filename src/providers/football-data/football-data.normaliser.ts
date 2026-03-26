import type { MatchStatus } from '@prisma/client';
import type { FDMatch } from './football-data.types.js';
import type { CanonicalMatch } from '../normalisation/canonical.types.js';

const PROVIDER = 'football-data';

// ─── Status mapping ─────────────────────────────────────────────────────────

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

// ─── Match → CanonicalMatch ──────────────────────────────────────────────────

export function normaliseMatch(
  match: FDMatch,
  internalMatchId: string,
  internalHomeTeamId: string,
  internalAwayTeamId: string,
  internalSeasonId: string,
  internalLeagueId: string,
): CanonicalMatch {
  return {
    internalId: internalMatchId,
    externalIds: { [PROVIDER]: String(match.id) },
    leagueId: internalLeagueId,
    seasonId: internalSeasonId,
    homeTeamId: internalHomeTeamId,
    awayTeamId: internalAwayTeamId,
    homeScore: match.score.fullTime.home ?? 0,
    awayScore: match.score.fullTime.away ?? 0,
    status: STATUS_MAP[match.status] ?? 'SCHEDULED',
    minute: null, // football-data.org does not expose elapsed minutes
    kickoffTime: new Date(match.utcDate),
    venue: '',    // venue not included in match response; available via GET /teams/:id
    round: match.matchday != null ? `Matchday ${match.matchday}` : match.stage,
  };
}

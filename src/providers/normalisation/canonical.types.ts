import type { MatchStatus, EventType } from '@prisma/client';

export type { MatchStatus, EventType };

export interface CanonicalLeague {
  internalId: string;
  externalIds: Record<string, string>;
  name: string;
  shortName: string;
  country: string;
  tier: number;
}

export interface CanonicalTeam {
  internalId: string;
  externalIds: Record<string, string>;
  name: string;
  shortName: string;
  logoUrl: string;
  countryCode: string;
}

export interface CanonicalMatch {
  internalId: string;
  externalIds: Record<string, string>;
  leagueId: string;
  seasonId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  status: MatchStatus;
  minute: number | null;
  kickoffTime: Date;
  venue: string;
  round?: string;
}

export interface CanonicalEvent {
  internalId: string;
  externalId: string;
  matchId: string;
  type: EventType;
  minute: number;
  addedTime?: number;
  teamId: string;
  playerId: string;
  assistPlayerId?: string;
  detail?: string;
  scoreAfter?: { home: number; away: number };
}

export interface CanonicalPlayer {
  internalId: string;
  externalIds: Record<string, string>;
  name: string;
  nationality?: string;
  position?: string;
  photoUrl?: string;
  teamId?: string;
}

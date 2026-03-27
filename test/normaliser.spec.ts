import { describe, it, expect } from 'vitest';
import { normaliseMatch } from '../src/providers/football-data/football-data.normaliser.js';
import type { FDMatch } from '../src/providers/football-data/football-data.types.js';

const mockMatch: FDMatch = {
  id: 12345,
  utcDate: '2024-12-01T15:00:00Z',
  status: 'FINISHED',
  matchday: 15,
  stage: 'REGULAR_SEASON',
  competition: { id: 2021, name: 'Premier League', code: 'PL' },
  season: { id: 1, startDate: '2024-08-01', endDate: '2025-05-31', currentMatchday: 15 },
  homeTeam: { id: 42, name: 'Arsenal', shortName: 'Arsenal', tla: 'ARS', crest: '' },
  awayTeam: { id: 49, name: 'Chelsea', shortName: 'Chelsea', tla: 'CHE', crest: '' },
  score: {
    winner: 'HOME_TEAM',
    fullTime: { home: 2, away: 1 },
    halfTime: { home: 1, away: 0 },
  },
  referees: [],
};

describe('football-data normaliser', () => {
  describe('normaliseMatch', () => {
    it('maps FINISHED status correctly', () => {
      const result = normaliseMatch(mockMatch, 'match-1', 'team-home', 'team-away', 'season-1', 'league-1');
      expect(result.status).toBe('FINISHED');
    });

    it('maps TIMED status to SCHEDULED', () => {
      const result = normaliseMatch(
        { ...mockMatch, status: 'TIMED' },
        'match-1', 'team-home', 'team-away', 'season-1', 'league-1',
      );
      expect(result.status).toBe('SCHEDULED');
    });

    it('maps IN_PLAY status to LIVE', () => {
      const result = normaliseMatch(
        { ...mockMatch, status: 'IN_PLAY' },
        'match-1', 'team-home', 'team-away', 'season-1', 'league-1',
      );
      expect(result.status).toBe('LIVE');
    });

    it('maps PAUSED status to HALFTIME', () => {
      const result = normaliseMatch(
        { ...mockMatch, status: 'PAUSED' },
        'match-1', 'team-home', 'team-away', 'season-1', 'league-1',
      );
      expect(result.status).toBe('HALFTIME');
    });

    it('sets homeScore and awayScore from fullTime goals', () => {
      const result = normaliseMatch(mockMatch, 'match-1', 'team-home', 'team-away', 'season-1', 'league-1');
      expect(result.homeScore).toBe(2);
      expect(result.awayScore).toBe(1);
    });

    it('defaults null scores to 0', () => {
      const result = normaliseMatch(
        { ...mockMatch, score: { winner: null, fullTime: { home: null, away: null }, halfTime: { home: null, away: null } } },
        'match-1', 'team-home', 'team-away', 'season-1', 'league-1',
      );
      expect(result.homeScore).toBe(0);
      expect(result.awayScore).toBe(0);
    });

    it('sets kickoffTime as a Date from utcDate', () => {
      const result = normaliseMatch(mockMatch, 'match-1', 'team-home', 'team-away', 'season-1', 'league-1');
      expect(result.kickoffTime).toBeInstanceOf(Date);
      expect(result.kickoffTime.toISOString()).toBe('2024-12-01T15:00:00.000Z');
    });

    it('sets round from matchday when present', () => {
      const result = normaliseMatch(mockMatch, 'match-1', 'team-home', 'team-away', 'season-1', 'league-1');
      expect(result.round).toBe('Matchday 15');
    });

    it('falls back to stage when matchday is null', () => {
      const result = normaliseMatch(
        { ...mockMatch, matchday: null },
        'match-1', 'team-home', 'team-away', 'season-1', 'league-1',
      );
      expect(result.round).toBe('REGULAR_SEASON');
    });

    it('sets correct internal IDs', () => {
      const result = normaliseMatch(mockMatch, 'match-1', 'team-home', 'team-away', 'season-1', 'league-1');
      expect(result.internalId).toBe('match-1');
      expect(result.homeTeamId).toBe('team-home');
      expect(result.awayTeamId).toBe('team-away');
      expect(result.seasonId).toBe('season-1');
      expect(result.leagueId).toBe('league-1');
    });
  });
});

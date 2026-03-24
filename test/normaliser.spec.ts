import { describe, it, expect } from 'vitest';
import {
  normaliseFixture,
  normaliseEvent,
} from '../src/providers/football-data/football-data.normaliser.js';
import type { ApiFootballFixture, ApiFootballEvent } from '../src/providers/football-data/football-data.types.js';

const mockFixture: ApiFootballFixture = {
  fixture: {
    id: 12345,
    referee: 'M. Oliver',
    timezone: 'UTC',
    date: '2024-12-01T15:00:00+00:00',
    timestamp: 1733061600,
    status: { long: 'Match Finished', short: 'FT', elapsed: 90 },
    venue: { id: 1, name: 'Emirates Stadium', city: 'London' },
  },
  league: {
    id: 39,
    name: 'Premier League',
    country: 'England',
    logo: 'https://example.com/pl.png',
    season: 2024,
    round: 'Regular Season - 15',
  },
  teams: {
    home: { id: 42, name: 'Arsenal', logo: '', winner: true },
    away: { id: 49, name: 'Chelsea', logo: '', winner: false },
  },
  goals: { home: 2, away: 1 },
};

const mockEvent: ApiFootballEvent = {
  time: { elapsed: 55, extra: null },
  team: { id: 42, name: 'Arsenal' },
  player: { id: 1100, name: 'Bukayo Saka' },
  assist: { id: 1101, name: 'Leandro Trossard' },
  type: 'Goal',
  detail: 'Normal Goal',
  comments: null,
};

describe('football-data normaliser', () => {
  describe('normaliseFixture', () => {
    it('maps FT status to FINISHED', () => {
      const result = normaliseFixture(
        mockFixture, 'match-1', 'team-home', 'team-away', 'season-1', 'league-1',
      );
      expect(result.status).toBe('FINISHED');
    });

    it('sets homeScore and awayScore from goals', () => {
      const result = normaliseFixture(
        mockFixture, 'match-1', 'team-home', 'team-away', 'season-1', 'league-1',
      );
      expect(result.homeScore).toBe(2);
      expect(result.awayScore).toBe(1);
    });

    it('sets kickoffTime as a Date', () => {
      const result = normaliseFixture(
        mockFixture, 'match-1', 'team-home', 'team-away', 'season-1', 'league-1',
      );
      expect(result.kickoffTime).toBeInstanceOf(Date);
    });
  });

  describe('normaliseEvent', () => {
    it('maps Goal type to GOAL', () => {
      const result = normaliseEvent(
        mockEvent, 12345, 'match-1', 'team-1', 'player-1', 'player-2',
      );
      expect(result?.type).toBe('GOAL');
    });

    it('returns null for unknown event types', () => {
      const unknown: ApiFootballEvent = { ...mockEvent, type: 'Unknown', detail: '' };
      const result = normaliseEvent(unknown, 12345, 'match-1', 'team-1', 'player-1');
      expect(result).toBeNull();
    });

    it('maps Own Goal detail to OWN_GOAL', () => {
      const ownGoal: ApiFootballEvent = { ...mockEvent, detail: 'Own Goal' };
      const result = normaliseEvent(ownGoal, 12345, 'match-1', 'team-1', 'player-1');
      expect(result?.type).toBe('OWN_GOAL');
    });

    it('includes assistPlayerId when provided', () => {
      const result = normaliseEvent(
        mockEvent, 12345, 'match-1', 'team-1', 'player-1', 'assist-1',
      );
      expect(result?.assistPlayerId).toBe('assist-1');
    });
  });
});

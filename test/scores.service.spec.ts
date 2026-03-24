import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScoresService } from '../src/scores/scores.service.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockMatches = [
  {
    id: 'match-1',
    homeScore: 1,
    awayScore: 0,
    status: 'LIVE',
    minute: 62,
    kickoffTime: new Date('2024-12-01T15:00:00Z'),
    venue: 'Emirates Stadium',
    round: 'Matchday 15',
    homeTeam: { id: 't1', name: 'Arsenal', shortName: 'ARS', logoUrl: null },
    awayTeam: { id: 't2', name: 'Chelsea', shortName: 'CHE', logoUrl: null },
    season: { league: { id: 'l1', name: 'Premier League', logoUrl: null } },
  },
];

const prismaMock = {
  reader: {
    match: {
      findMany: vi.fn().mockResolvedValue(mockMatches),
      findUnique: vi.fn(),
    },
    matchEvent: { findMany: vi.fn().mockResolvedValue([]) },
  },
  writer: {
    match: { findUnique: vi.fn().mockResolvedValue(mockMatches[0]) },
    matchEvent: { findMany: vi.fn().mockResolvedValue([]) },
  },
};

const redisMock = {
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue(undefined),
  del: vi.fn().mockResolvedValue(undefined),
  cachedFetch: vi.fn().mockImplementation(
    async (_key: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher(),
  ),
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ScoresService', () => {
  let service: ScoresService;

  beforeEach(() => {
    service = new ScoresService(prismaMock as never, redisMock as never);
    vi.clearAllMocks();
  });

  describe('getMatchesByDate', () => {
    it('returns matches grouped by league', async () => {
      redisMock.cachedFetch.mockImplementation(
        async (_k: string, _t: number, fn: () => Promise<unknown>) => fn(),
      );

      const result = await service.getMatchesByDate('2024-12-01');

      expect(result).toHaveLength(1);
      expect(result[0].leagueId).toBe('l1');
      expect(result[0].matches).toHaveLength(1);
      expect(result[0].matches[0].status).toBe('LIVE');
    });

    it('returns cached result when cache hits', async () => {
      const cached = [{ leagueId: 'l1', leagueName: 'PL', logoUrl: null, matches: [] }];
      redisMock.cachedFetch.mockResolvedValueOnce(cached);

      const result = await service.getMatchesByDate('2024-12-01');
      expect(result).toBe(cached);
      expect(prismaMock.reader.match.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getMatchById', () => {
    it('throws NotFoundException when match does not exist', async () => {
      prismaMock.writer.match.findUnique.mockResolvedValueOnce(null);
      redisMock.get.mockResolvedValueOnce(null);

      await expect(service.getMatchById('not-found')).rejects.toThrow('Match not-found not found');
    });

    it('returns a match DTO with correct shape', async () => {
      redisMock.get.mockResolvedValueOnce(null);

      const result = await service.getMatchById('match-1');
      expect(result.id).toBe('match-1');
      expect(result.status).toBe('LIVE');
    });
  });

  describe('invalidateMatchCache', () => {
    it('deletes all relevant cache keys', async () => {
      await service.invalidateMatchCache('match-1', '2024-12-01');

      expect(redisMock.del).toHaveBeenCalledWith(
        'matches:2024-12-01',
        'match:match-1',
        'match:match-1:stats',
        'match:match-1:events',
      );
    });
  });
});

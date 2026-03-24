import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SearchService } from '../src/search/search.service.js';

const mockPlayers = [
  { id: 'p1', name: 'Bukayo Saka', popularityScore: 95, photoUrl: null, nationality: 'England', team: { name: 'Arsenal' } },
];
const mockTeams = [
  { id: 't1', name: 'Arsenal', shortName: 'ARS', logoUrl: null, countryCode: 'GB' },
];
const mockLeagues = [
  { id: 'l1', name: 'Premier League', logoUrl: null, country: 'England' },
];

const prismaMock = {
  reader: {
    player: { findMany: vi.fn().mockResolvedValue(mockPlayers) },
    team: { findMany: vi.fn().mockResolvedValue(mockTeams) },
    league: { findMany: vi.fn().mockResolvedValue(mockLeagues) },
  },
};

const redisMock = {
  cachedFetch: vi.fn().mockImplementation(
    async (_k: string, _t: number, fn: () => Promise<unknown>) => fn(),
  ),
};

describe('SearchService', () => {
  let service: SearchService;

  beforeEach(() => {
    service = new SearchService(prismaMock as never, redisMock as never);
    vi.clearAllMocks();
  });

  it('returns results for all types by default', async () => {
    const result = await service.search({ q: 'Arsenal', type: 'all' });

    expect(result.results.some((r) => r.type === 'player')).toBe(true);
    expect(result.results.some((r) => r.type === 'team')).toBe(true);
    expect(result.results.some((r) => r.type === 'league')).toBe(true);
    expect(result.total).toBe(3);
  });

  it('returns only team results when type=teams', async () => {
    prismaMock.reader.player.findMany.mockResolvedValue([]);
    prismaMock.reader.league.findMany.mockResolvedValue([]);

    const result = await service.search({ q: 'Arsenal', type: 'teams' });

    expect(result.results.every((r) => r.type === 'team')).toBe(true);
  });

  it('maps player result with team subtitle', async () => {
    const result = await service.search({ q: 'Saka', type: 'players' });
    const player = result.results.find((r) => r.type === 'player');

    expect(player?.name).toBe('Bukayo Saka');
    expect(player?.subtitle).toBe('Arsenal');
  });
});

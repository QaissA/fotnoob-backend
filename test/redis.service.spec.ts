import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RedisService } from '../src/redis/redis.service.js';

// Mock ioredis
vi.mock('ioredis', () => {
  const Redis = vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(),
    set: vi.fn().mockResolvedValue('OK'),
    setex: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    publish: vi.fn().mockResolvedValue(1),
    on: vi.fn(),
  }));
  return { default: Redis };
});

const configMock = {
  get: vi.fn().mockReturnValue('redis://localhost:6379'),
};

describe('RedisService', () => {
  let service: RedisService;

  beforeEach(async () => {
    service = new RedisService(configMock as never);
    await service.onModuleInit();
    vi.clearAllMocks();
  });

  describe('get', () => {
    it('returns null when key does not exist', async () => {
      (service.client.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const result = await service.get('missing-key');
      expect(result).toBeNull();
    });

    it('deserialises JSON value', async () => {
      (service.client.get as ReturnType<typeof vi.fn>).mockResolvedValue(
        JSON.stringify({ id: 'match-1' }),
      );
      const result = await service.get<{ id: string }>('match:1');
      expect(result?.id).toBe('match-1');
    });
  });

  describe('set', () => {
    it('calls setex when TTL is provided', async () => {
      await service.set('key', { data: 1 }, 60);
      expect(service.client.setex).toHaveBeenCalledWith('key', 60, JSON.stringify({ data: 1 }));
    });

    it('calls set without TTL when ttlSeconds is omitted', async () => {
      await service.set('key', { data: 1 });
      expect(service.client.set).toHaveBeenCalledWith('key', JSON.stringify({ data: 1 }));
    });
  });

  describe('cachedFetch', () => {
    it('calls fetcher on cache miss and stores result', async () => {
      (service.client.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      const fetcher = vi.fn().mockResolvedValue({ id: 'fresh' });

      const result = await service.cachedFetch('key', 30, fetcher);

      expect(fetcher).toHaveBeenCalledOnce();
      expect(service.client.setex).toHaveBeenCalled();
      expect(result).toEqual({ id: 'fresh' });
    });

    it('returns cached value without calling fetcher', async () => {
      (service.client.get as ReturnType<typeof vi.fn>).mockResolvedValue(
        JSON.stringify({ id: 'cached' }),
      );
      const fetcher = vi.fn();

      const result = await service.cachedFetch('key', 30, fetcher);

      expect(fetcher).not.toHaveBeenCalled();
      expect(result).toEqual({ id: 'cached' });
    });
  });
});

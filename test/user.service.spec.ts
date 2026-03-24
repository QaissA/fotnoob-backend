import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { UserService } from '../src/user/user.service.js';

const bcryptMock = await vi.hoisted(async () => {
  const mod = await import('bcryptjs');
  return {
    hash: vi.fn().mockImplementation((val: string) => Promise.resolve(`hashed:${val}`)),
    compare: vi.fn().mockResolvedValue(true),
    genSalt: mod.genSalt,
  };
});

vi.mock('bcryptjs', () => bcryptMock);

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  passwordHash: 'hashed:password123',
  displayName: 'Tester',
  avatarUrl: null,
  locale: 'en',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const prismaMock = {
  reader: {
    user: { findUnique: vi.fn() },
    userFavouriteTeam: { findMany: vi.fn().mockResolvedValue([]) },
    userFavouriteLeague: { findMany: vi.fn().mockResolvedValue([]) },
    userFavouritePlayer: { findMany: vi.fn().mockResolvedValue([]) },
    refreshToken: { findMany: vi.fn().mockResolvedValue([]) },
  },
  writer: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn().mockResolvedValue(mockUser),
    },
    refreshToken: {
      create: vi.fn().mockResolvedValue({ id: 'rt-1' }),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
  },
};

const redisMock = {
  del: vi.fn(),
  cachedFetch: vi.fn().mockImplementation(
    async (_k: string, _t: number, fn: () => Promise<unknown>) => fn(),
  ),
};

const jwtMock = {
  sign: vi.fn().mockReturnValue('mock.jwt.token'),
  verify: vi.fn(),
};

const configMock = {
  get: vi.fn().mockReturnValue('mock-secret'),
};

describe('UserService', () => {
  let service: UserService;

  beforeEach(() => {
    service = new UserService(
      prismaMock as never,
      redisMock as never,
      jwtMock as never,
      configMock as never,
    );
    vi.clearAllMocks();
  });

  describe('register', () => {
    it('creates a new user and returns tokens + profile', async () => {
      prismaMock.reader.user.findUnique.mockResolvedValue(null);
      prismaMock.writer.user.create.mockResolvedValue(mockUser);

      const result = await service.register({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result.user.email).toBe('test@example.com');
      expect(result.tokens.accessToken).toBe('mock.jwt.token');
    });

    it('throws ConflictException when email already exists', async () => {
      prismaMock.reader.user.findUnique.mockResolvedValue(mockUser);

      await expect(
        service.register({ email: 'test@example.com', password: 'password123' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('returns tokens when credentials are valid', async () => {
      prismaMock.writer.user.findUnique.mockResolvedValue(mockUser);
      bcryptMock.compare.mockResolvedValue(true);

      const result = await service.login({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result.tokens.accessToken).toBeDefined();
    });

    it('throws UnauthorizedException for wrong password', async () => {
      prismaMock.writer.user.findUnique.mockResolvedValue(mockUser);
      bcryptMock.compare.mockResolvedValue(false);

      await expect(
        service.login({ email: 'test@example.com', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for unknown email', async () => {
      prismaMock.writer.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'no@one.com', password: 'pass' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});

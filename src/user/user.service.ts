import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import type { AppConfig } from '../config/configuration.js';
import type {
  RegisterDto,
  LoginDto,
  AuthResponseDto,
  TokenResponseDto,
  UserProfileDto,
} from './dto/auth.dto.js';
import type { UpdateFavouritesDto, FavouritesResponseDto } from './dto/favourites.dto.js';

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig>,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    const existing = await this.prisma.reader.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException('Email already in use');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.writer.user.create({
      data: {
        email: dto.email,
        passwordHash,
        displayName: dto.displayName,
      },
    });

    const tokens = await this.issueTokens(user.id, user.email);
    return { tokens, user: this.toProfileDto(user) };
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.prisma.writer.user.findUnique({
      where: { email: dto.email },
    });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.issueTokens(user.id, user.email);
    return { tokens, user: this.toProfileDto(user) };
  }

  async refresh(rawToken: string): Promise<TokenResponseDto> {
    let payload: { sub: string; email: string; type: string };
    try {
      payload = this.jwt.verify<typeof payload>(rawToken, {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (payload.type !== 'refresh') throw new UnauthorizedException();

    // Verify token hash exists and is not revoked
    const allTokens = await this.prisma.reader.refreshToken.findMany({
      where: { userId: payload.sub, revokedAt: null },
    });

    const valid = await Promise.all(
      allTokens.map((t) => bcrypt.compare(rawToken, t.tokenHash).then((ok) => ok ? t : null)),
    );
    const storedToken = valid.find((t) => t !== null);
    if (!storedToken) throw new UnauthorizedException('Token revoked');

    // Rotate: revoke old, issue new
    await this.prisma.writer.refreshToken.update({
      where: { id: storedToken.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(payload.sub, payload.email);
  }

  async logout(userId: string): Promise<void> {
    await this.prisma.writer.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.redis.del(`user:${userId}:favourites`);
  }

  async getProfile(userId: string): Promise<UserProfileDto> {
    const user = await this.prisma.reader.user.findUnique({
      where: { id: userId },
    });
    if (!user) throw new NotFoundException('User not found');
    return this.toProfileDto(user);
  }

  async getFavourites(userId: string): Promise<FavouritesResponseDto> {
    const cacheKey = `user:${userId}:favourites`;
    return this.redis.cachedFetch(cacheKey, 300, async () => {
      const [teams, leagues, players] = await Promise.all([
        this.prisma.reader.userFavouriteTeam.findMany({ where: { userId } }),
        this.prisma.reader.userFavouriteLeague.findMany({ where: { userId } }),
        this.prisma.reader.userFavouritePlayer.findMany({ where: { userId } }),
      ]);
      return {
        teamIds: teams.map((t) => t.teamId),
        leagueIds: leagues.map((l) => l.leagueId),
        playerIds: players.map((p) => p.playerId),
      };
    });
  }

  async updateFavourites(
    userId: string,
    dto: UpdateFavouritesDto,
  ): Promise<FavouritesResponseDto> {
    await this.prisma.writer.$transaction(async (tx) => {
      if (dto.teamIds !== undefined) {
        await tx.userFavouriteTeam.deleteMany({ where: { userId } });
        await tx.userFavouriteTeam.createMany({
          data: dto.teamIds.map((teamId) => ({ userId, teamId })),
        });
      }
      if (dto.leagueIds !== undefined) {
        await tx.userFavouriteLeague.deleteMany({ where: { userId } });
        await tx.userFavouriteLeague.createMany({
          data: dto.leagueIds.map((leagueId) => ({ userId, leagueId })),
        });
      }
      if (dto.playerIds !== undefined) {
        await tx.userFavouritePlayer.deleteMany({ where: { userId } });
        await tx.userFavouritePlayer.createMany({
          data: dto.playerIds.map((playerId) => ({ userId, playerId })),
        });
      }
    });

    await this.redis.del(`user:${userId}:favourites`);
    return this.getFavourites(userId);
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private async issueTokens(userId: string, email: string): Promise<TokenResponseDto> {
    const accessToken = this.jwt.sign(
      { sub: userId, email },
      {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
        expiresIn: this.config.get('JWT_ACCESS_EXPIRES_IN', { infer: true }),
      },
    );
    const refreshToken = this.jwt.sign(
      { sub: userId, email, type: 'refresh' },
      {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
        expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN', { infer: true }),
      },
    );

    await this.prisma.writer.refreshToken.create({
      data: {
        userId,
        tokenHash: await bcrypt.hash(refreshToken, 10),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    return { accessToken, refreshToken };
  }

  private toProfileDto(user: {
    id: string;
    email: string;
    displayName: string | null;
    avatarUrl: string | null;
    locale: string;
    createdAt: Date;
  }): UserProfileDto {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      locale: user.locale,
      createdAt: user.createdAt.toISOString(),
    };
  }
}

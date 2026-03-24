import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import type { RegisterFcmDto, UpdatePrefsDto, NotificationPrefsDto } from './dto/notifications.dto.js';

export interface MatchNotificationPayload {
  matchId: string;
  type: 'GOAL' | 'KICKOFF' | 'FINAL_WHISTLE' | 'LINEUP';
  title: string;
  body: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {
    // Subscribe to match events published by the Scores service
    void this.redis.subscriber.subscribe('match-events', 'match-finished');
    this.redis.subscriber.on('message', (channel: string, data: string) => {
      void this.handleRedisMessage(channel, data);
    });
  }

  async registerFcmToken(userId: string, dto: RegisterFcmDto): Promise<void> {
    await this.prisma.writer.fcmToken.upsert({
      where: { token: dto.token },
      create: { userId, token: dto.token, platform: dto.platform },
      update: { userId },
    });
  }

  async removeFcmToken(userId: string, token: string): Promise<void> {
    await this.prisma.writer.fcmToken.deleteMany({
      where: { userId, token },
    });
  }

  async getPrefs(userId: string): Promise<NotificationPrefsDto> {
    const prefs = await this.prisma.reader.notificationPrefs.findUnique({
      where: { userId },
    });
    return {
      goals: prefs?.goals ?? true,
      kickoff: prefs?.kickoff ?? true,
      lineups: prefs?.lineups ?? false,
      finalWhistle: prefs?.finalWhistle ?? true,
      news: prefs?.news ?? false,
    };
  }

  async updatePrefs(userId: string, dto: UpdatePrefsDto): Promise<NotificationPrefsDto> {
    await this.prisma.writer.notificationPrefs.upsert({
      where: { userId },
      create: { userId, ...dto },
      update: dto,
    });
    return this.getPrefs(userId);
  }

  // ─── Event-driven fan-out ────────────────────────────────────────────────

  private async handleRedisMessage(channel: string, data: string): Promise<void> {
    try {
      if (channel === 'match-events') {
        const event = JSON.parse(data) as { matchId: string; type: string; teamId: string };
        if (event.type === 'GOAL') {
          await this.fanOutGoalNotification(event.matchId, event.teamId);
        }
      }
      if (channel === 'match-finished') {
        const payload = JSON.parse(data) as { matchId: string };
        await this.fanOutFinalWhistle(payload.matchId);
      }
    } catch (err) {
      this.logger.error('Error handling redis message', err);
    }
  }

  private async fanOutGoalNotification(matchId: string, teamId: string): Promise<void> {
    const match = await this.prisma.writer.match.findUnique({
      where: { id: matchId },
      include: { homeTeam: true, awayTeam: true },
    });
    if (!match) return;

    const title = `⚽ Goal! ${match.homeTeam.shortName} ${match.homeScore} - ${match.awayScore} ${match.awayTeam.shortName}`;
    const body = `Minute ${match.minute ?? '?'}`;

    // Fan-out to subscribers of either team — paginated in batches of 1000
    for (const fanTeamId of [match.homeTeamId, match.awayTeamId]) {
      await this.sendToTeamSubscribers(fanTeamId, title, body, 'goals');
    }

    this.logger.debug(`Goal notification sent for match ${matchId}`);
  }

  private async fanOutFinalWhistle(matchId: string): Promise<void> {
    const match = await this.prisma.writer.match.findUnique({
      where: { id: matchId },
      include: { homeTeam: true, awayTeam: true },
    });
    if (!match) return;

    const title = `FT: ${match.homeTeam.shortName} ${match.homeScore} - ${match.awayScore} ${match.awayTeam.shortName}`;
    const body = 'Full time!';

    for (const fanTeamId of [match.homeTeamId, match.awayTeamId]) {
      await this.sendToTeamSubscribers(fanTeamId, title, body, 'finalWhistle');
    }
  }

  private async sendToTeamSubscribers(
    teamId: string,
    title: string,
    body: string,
    prefKey: keyof NotificationPrefsDto,
  ): Promise<void> {
    let cursor: string | undefined;

    while (true) {
      const batch = await this.prisma.reader.userFavouriteTeam.findMany({
        where: { teamId },
        include: { user: { include: { fcmTokens: true, notificationPrefs: true } } },
        take: 1000,
        ...(cursor
          ? { skip: 1, cursor: { userId_teamId: { userId: cursor, teamId } } }
          : {}),
      });

      if (batch.length === 0) break;

      for (const fav of batch) {
        const prefs = fav.user.notificationPrefs;
        const enabled = prefs ? prefs[prefKey as keyof typeof prefs] : true;
        if (!enabled) continue;

        for (const fcm of fav.user.fcmTokens) {
          this.logger.debug(`[FCM] → ${fcm.token.slice(0, 12)}… | ${title}`);
          // TODO: replace with real FCM SDK call (firebase-admin)
        }
      }

      cursor = batch[batch.length - 1]!.userId;
      if (batch.length < 1000) break;
    }
  }
}

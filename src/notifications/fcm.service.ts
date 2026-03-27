import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import type { AppConfig } from '../config/configuration.js';

const FCM_BATCH_SIZE = 500;

const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

@Injectable()
export class FcmService implements OnModuleInit {
  private readonly logger = new Logger(FcmService.name);
  private messaging: admin.messaging.Messaging | null = null;

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  onModuleInit(): void {
    const raw = this.config.get('FIREBASE_SERVICE_ACCOUNT_JSON', { infer: true });
    if (!raw) {
      this.logger.warn('FIREBASE_SERVICE_ACCOUNT_JSON not set — FCM disabled');
      return;
    }

    try {
      const serviceAccount = JSON.parse(raw) as admin.ServiceAccount;
      const app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
      this.messaging = app.messaging();
      this.logger.log('Firebase Admin SDK initialised');
    } catch (err) {
      this.logger.error('Failed to initialise Firebase Admin SDK', err);
    }
  }

  /**
   * Send a multicast push notification to a list of FCM tokens.
   * Tokens are chunked into batches of 500 (FCM limit).
   *
   * @returns Array of invalid token strings that should be pruned from the DB
   */
  async sendMulticast(tokens: string[], title: string, body: string): Promise<string[]> {
    if (!this.messaging || tokens.length === 0) return [];

    const invalidTokens: string[] = [];

    for (let i = 0; i < tokens.length; i += FCM_BATCH_SIZE) {
      const chunk = tokens.slice(i, i + FCM_BATCH_SIZE);

      const response = await this.messaging.sendEachForMulticast({
        tokens: chunk,
        notification: { title, body },
        android: { priority: 'high' },
        apns: { payload: { aps: { sound: 'default' } } },
      });

      response.responses.forEach((res, idx) => {
        if (!res.success && res.error && INVALID_TOKEN_CODES.has(res.error.code)) {
          invalidTokens.push(chunk[idx]!);
        }
      });

      this.logger.debug(
        `FCM batch ${Math.floor(i / FCM_BATCH_SIZE) + 1}: ` +
          `${response.successCount} sent, ${response.failureCount} failed`,
      );
    }

    return invalidTokens;
  }
}

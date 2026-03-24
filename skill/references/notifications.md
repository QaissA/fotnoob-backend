# Push Notification Engine

Deep dive into building FotMob's scale notification system in-house on AWS. Third-party providers (Firebase alone, OneSignal) crash at peak match load — this is how you own it.

---

## Table of Contents
1. [Architecture Overview](#1-architecture-overview)
2. [Notification Service](#2-notification-service)
3. [Fan-Out Pipeline](#3-fan-out-pipeline)
4. [APNs Integration (iOS)](#4-apns-integration-ios)
5. [FCM Integration (Android)](#5-fcm-integration-android)
6. [Notification Types & Payloads](#6-notification-types--payloads)
7. [User Subscription Management](#7-user-subscription-management)
8. [Scaling to Billions](#8-scaling-to-billions)
9. [Delivery Tracking](#9-delivery-tracking)

---

## 1. Architecture Overview

```
Match Event (Redis pub/sub)
          │
          ▼
 Notification Trigger Service
 (subscribes to match-events)
          │
          ▼
 User Fan-Out Lambda
 (query: who follows this team?)
          │
       batches
          ▼
 SQS FIFO Queue (per region)
          │
     workers consume
          ▼
 ┌────────────────────────┐
 │   EKS Notif Workers    │
 │  (horizontally scaled) │
 │                        │
 │  ┌──────┐  ┌────────┐  │
 │  │ APNs │  │  FCM   │  │
 │  │ iOS  │  │Android │  │
 │  └──────┘  └────────┘  │
 └────────────────────────┘
          │
          ▼
 Delivery log → S3 (metrics)
```

---

## 2. Notification Service

The trigger service subscribes to Redis and decides whether to fire a notification.

```typescript
// services/notifications/src/index.ts
import { Redis } from 'ioredis';
import { FanOutService } from './fan-out.service';
import { shouldNotify } from './rules';
import type { MatchEvent, CanonicalEvent } from '@fotmob/shared';

const sub = new Redis(process.env.REDIS_URL!);
const fanOut = new FanOutService();

sub.subscribe('match-events');

sub.on('message', async (_, data) => {
  const event: CanonicalEvent = JSON.parse(data);

  // Only fire on high-value events
  if (!shouldNotify(event)) return;

  await fanOut.dispatch(event);
});

// Notification rules
export function shouldNotify(event: CanonicalEvent): boolean {
  const notifiableTypes: EventType[] = [
    'GOAL', 'OWN_GOAL', 'RED_CARD', 'PENALTY_SCORED', 'PENALTY_MISSED'
  ];
  return notifiableTypes.includes(event.type);
}
```

---

## 3. Fan-Out Pipeline

The most critical performance problem: finding all users who follow a team, then sending millions of notifications within seconds.

```typescript
// services/notifications/src/fan-out.service.ts
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({ region: process.env.AWS_REGION });
const QUEUE_URL = process.env.NOTIF_QUEUE_URL!;
const BATCH_SIZE = 10;  // SQS SendMessageBatch max

export class FanOutService {
  async dispatch(event: CanonicalEvent): Promise<void> {
    const notification = buildNotificationPayload(event);

    // Stream users in pages — never load all at once
    let totalDispatched = 0;
    for await (const userBatch of getUsersForTeam(event.teamId)) {
      const sqsBatch = userBatch.map((u, i) => ({
        Id: `${i}`,
        MessageBody: JSON.stringify({
          userId: u.userId,
          fcmTokens: u.user.fcmTokens.filter(t => t.platform === 'android').map(t => t.token),
          apnsTokens: u.user.fcmTokens.filter(t => t.platform === 'ios').map(t => t.token),
          notification,
        }),
        MessageGroupId: event.matchId,  // FIFO grouping
        MessageDeduplicationId: `${event.externalId}-${u.userId}`,
      }));

      // Send to SQS in batches of 10 (SQS limit)
      for (let i = 0; i < sqsBatch.length; i += BATCH_SIZE) {
        await sqs.send(new SendMessageBatchCommand({
          QueueUrl: QUEUE_URL,
          Entries: sqsBatch.slice(i, i + BATCH_SIZE),
        }));
      }
      totalDispatched += userBatch.length;
    }
    console.log(`Dispatched ${totalDispatched} notifications for event ${event.externalId}`);
  }
}
```

---

## 4. APNs Integration (iOS)

Use the **HTTP/2 APNs API** (not the legacy binary protocol). Use JWT auth (simpler than certificates).

```typescript
// services/notifications/src/senders/apns.ts
import http2 from 'http2';
import jwt from 'jsonwebtoken';
import fs from 'fs';

const APNS_HOST = process.env.NODE_ENV === 'production'
  ? 'api.push.apple.com'
  : 'api.sandbox.push.apple.com';

const APNS_KEY = fs.readFileSync(process.env.APNS_KEY_PATH!, 'utf8');
const APNS_KEY_ID = process.env.APNS_KEY_ID!;
const APNS_TEAM_ID = process.env.APNS_TEAM_ID!;
const BUNDLE_ID = process.env.IOS_BUNDLE_ID!;

// JWT token — valid for 60min, reuse across requests
let apnsToken: string | null = null;
let tokenGeneratedAt = 0;

function getApnsToken(): string {
  if (apnsToken && Date.now() - tokenGeneratedAt < 55 * 60 * 1000) return apnsToken;

  apnsToken = jwt.sign({}, APNS_KEY, {
    algorithm: 'ES256',
    keyid: APNS_KEY_ID,
    issuer: APNS_TEAM_ID,
    subject: BUNDLE_ID,
    expiresIn: '60m',
  });
  tokenGeneratedAt = Date.now();
  return apnsToken;
}

// Persistent HTTP/2 connection — reuse across sends
let client: http2.ClientHttp2Session | null = null;

function getClient(): http2.ClientHttp2Session {
  if (client && !client.destroyed) return client;
  client = http2.connect(`https://${APNS_HOST}`);
  client.on('error', () => { client = null; });
  return client;
}

export async function sendAPNs(
  deviceToken: string,
  payload: APNsPayload
): Promise<{ success: boolean; invalidToken?: boolean }> {
  return new Promise((resolve) => {
    const client = getClient();
    const body = JSON.stringify(payload);

    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      ':scheme': 'https',
      ':authority': APNS_HOST,
      'authorization': `bearer ${getApnsToken()}`,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'apns-topic': BUNDLE_ID,
      'apns-expiration': String(Math.floor(Date.now() / 1000) + 3600),
      'apns-collapse-id': payload.collapseId ?? undefined,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    });

    req.write(body);
    req.end();

    let status = 0;
    let responseBody = '';

    req.on(':response', (headers) => { status = headers[':status'] as number; });
    req.on('data', (chunk) => { responseBody += chunk; });
    req.on('end', () => {
      if (status === 200) {
        resolve({ success: true });
      } else {
        const err = JSON.parse(responseBody || '{}');
        const invalidToken = err.reason === 'BadDeviceToken' || err.reason === 'Unregistered';
        resolve({ success: false, invalidToken });
      }
    });
    req.on('error', () => resolve({ success: false }));
  });
}

interface APNsPayload {
  aps: {
    alert: { title: string; body: string };
    sound: string;
    badge?: number;
    'content-available'?: 1;
  };
  data: Record<string, string>;
  collapseId?: string;
}
```

### Batch send with token cleanup
```typescript
export async function batchSendAPNs(
  tokens: string[],
  notification: NotificationPayload
): Promise<void> {
  const results = await Promise.allSettled(
    tokens.map(token => sendAPNs(token, buildApnsPayload(notification)))
  );

  const invalidTokens = tokens.filter((_, i) => {
    const result = results[i];
    return result.status === 'fulfilled' && result.value.invalidToken;
  });

  // Clean up invalid tokens from DB
  if (invalidTokens.length > 0) {
    await prisma.fcmToken.deleteMany({
      where: { token: { in: invalidTokens } }
    });
  }
}
```

---

## 5. FCM Integration (Android)

Use the **Firebase Admin SDK** for server-side sending.

```typescript
// services/notifications/src/senders/fcm.ts
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getMessaging, MulticastMessage } from 'firebase-admin/messaging';

if (!getApps().length) {
  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT!)),
  });
}

const messaging = getMessaging();

// FCM supports up to 500 tokens per multicast send
const FCM_BATCH_SIZE = 500;

export async function batchSendFCM(
  tokens: string[],
  notification: NotificationPayload
): Promise<void> {
  for (let i = 0; i < tokens.length; i += FCM_BATCH_SIZE) {
    const batch = tokens.slice(i, i + FCM_BATCH_SIZE);

    const message: MulticastMessage = {
      tokens: batch,
      notification: {
        title: notification.title,
        body: notification.body,
        imageUrl: notification.imageUrl,
      },
      data: {
        type: notification.type,
        matchId: notification.matchId,
        deepLink: notification.deepLink,
      },
      android: {
        priority: 'high',
        collapseKey: `match:${notification.matchId}`,
        notification: {
          channelId: 'live_scores',
          priority: 'max',
          defaultSound: true,
        },
      },
    };

    const response = await messaging.sendEachForMulticast(message);

    // Remove invalid/expired tokens
    const invalidTokens = response.responses
      .map((r, idx) => ({ r, token: batch[idx] }))
      .filter(({ r }) => !r.success &&
        (r.error?.code === 'messaging/registration-token-not-registered' ||
         r.error?.code === 'messaging/invalid-registration-token'))
      .map(({ token }) => token);

    if (invalidTokens.length > 0) {
      await prisma.fcmToken.deleteMany({ where: { token: { in: invalidTokens } } });
    }
  }
}
```

---

## 6. Notification Types & Payloads

```typescript
// packages/shared/src/notifications/payloads.ts

export type NotificationType = 'goal' | 'red_card' | 'kick_off' | 'full_time' | 'lineup' | 'news';

export interface NotificationPayload {
  type: NotificationType;
  title: string;
  body: string;
  matchId?: string;
  teamId?: string;
  articleId?: string;
  deepLink: string;
  imageUrl?: string;
  collapseKey?: string;  // later notif replaces earlier one if same key
}

export function buildNotificationPayload(event: CanonicalEvent, match: Match): NotificationPayload {
  switch (event.type) {
    case 'GOAL':
    case 'OWN_GOAL': {
      const scorer = event.playerName;
      const team = event.teamId === match.homeTeamId ? match.homeTeam : match.awayTeam;
      return {
        type: 'goal',
        title: `⚽ GOAL — ${match.homeTeam.shortName} ${match.homeScore}–${match.awayScore} ${match.awayTeam.shortName}`,
        body: `${scorer} ${event.minute}'${event.addedTime ? `+${event.addedTime}` : ''}`,
        matchId: match.id,
        deepLink: `/match/${match.id}`,
        collapseKey: `match:${match.id}:score`,   // replaces previous score notification
      };
    }
    case 'RED_CARD':
      return {
        type: 'red_card',
        title: `🟥 Red card — ${event.playerName}`,
        body: `${match.homeTeam.shortName} vs ${match.awayTeam.shortName} · ${event.minute}'`,
        matchId: match.id,
        deepLink: `/match/${match.id}`,
      };
    default:
      throw new Error(`No payload builder for event type ${event.type}`);
  }
}
```

---

## 7. User Subscription Management

```typescript
// When a user adds a team to favourites → subscribe to that team's match channels
export async function syncSubscriptions(userId: string, teamIds: string[]): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { favouriteTeams: true, notificationPrefs: true },
  });

  // No action needed in DB — subscriptions are derived from favourites at fan-out time.
  // This function is a hook for future topic-based subscription systems (e.g. SNS topics).
  console.log(`User ${userId} subscribed to ${teamIds.length} teams`);
}

// Notification preference check at fan-out time
export function isUserSubscribedToEventType(
  prefs: NotificationPrefs,
  eventType: EventType
): boolean {
  switch (eventType) {
    case 'GOAL':
    case 'OWN_GOAL':
    case 'PENALTY_SCORED':
      return prefs.goals;
    case 'RED_CARD':
    case 'SECOND_YELLOW':
      return prefs.goals;   // grouped with goals pref for simplicity
    default:
      return false;
  }
}
```

---

## 8. Scaling to Billions

FotMob sends **3B+ notifications/week** — here's the architecture that makes that work:

### Key design decisions
1. **Stateless workers** — each EKS pod consumes from SQS independently. Scale to 50+ pods during World Cup finals.
2. **KEDA autoscaling** — workers scale on SQS queue depth (see `devops.md`). Handles the spike at match kick-off automatically.
3. **HTTP/2 multiplexing for APNs** — one persistent TCP connection handles thousands of requests/sec. Never open a new connection per notification.
4. **FCM multicast** — send to 500 tokens per API call, not one at a time.
5. **No per-match fan-out in a single Lambda** — split across SQS messages so no single Lambda times out.
6. **Collapse keys** — rapid score changes (90+ min extra time) produce one notification, not 20.

### Throughput math
- Match with 50k followers on each team = 100k notifications
- FCM multicast: 100k / 500 = 200 API calls per match event
- APNs HTTP/2: ~1k req/sec per connection, need ~100 connections for 100k in 1 second
- EKS: 10 pods × 10 APNs connections × 1k/s = 100k APNs/sec ✓
- At World Cup scale (500k followers per team): scale to 50 pods automatically via KEDA

---

## 9. Delivery Tracking

Track delivery rates to catch provider issues early.

```typescript
// Log delivery outcome to S3 for analytics
export async function logDelivery(
  eventId: string,
  platform: 'ios' | 'android',
  sent: number,
  delivered: number,
  failed: number,
  invalidTokens: number,
): Promise<void> {
  const record = {
    eventId,
    platform,
    sent,
    delivered,
    failed,
    invalidTokens,
    successRate: delivered / sent,
    timestamp: new Date().toISOString(),
  };

  // Append to S3 for Athena/Glue analytics
  const key = `delivery-logs/${new Date().toISOString().split('T')[0]}/${eventId}-${platform}.json`;
  await s3.putObject({
    Bucket: 'fotmob-stats',
    Key: key,
    Body: JSON.stringify(record),
    ContentType: 'application/json',
  });

  // Alert if success rate drops below 95%
  if (record.successRate < 0.95) {
    await alertOncall(`Low delivery rate: ${Math.round(record.successRate * 100)}% on ${platform}`);
  }
}
```

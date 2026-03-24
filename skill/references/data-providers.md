# Data Providers & Ingestion Pipeline

How to connect to sports data providers, normalise their feeds, and build a reliable real-time ingestion pipeline.

---

## Table of Contents
1. [Provider Comparison & Selection](#1-provider-comparison--selection)
2. [Canonical Data Model](#2-canonical-data-model)
3. [Stats Perform / Opta Integration](#3-stats-perform--opta-integration)
4. [SportRadar Integration](#4-sportradar-integration)
5. [ESPN API (Free Tier / MVP)](#5-espn-api-free-tier--mvp)
6. [Ingestion Lambda](#6-ingestion-lambda)
7. [Normalisation Layer](#7-normalisation-layer)
8. [Reliability & Error Handling](#8-reliability--error-handling)
9. [Data Sync & Backfill Jobs](#9-data-sync--backfill-jobs)

---

## 1. Provider Comparison & Selection

| Provider | Coverage | Latency | Price | Best for |
|----------|----------|---------|-------|----------|
| **Stats Perform / Opta** | 800+ competitions, 45+ years history | < 1s push | $$$$  | Production, professional |
| **SportRadar** | 750+ competitions | 1–3s push | $$$   | Production, good docs |
| **Football-Data.org** | Top 12 European leagues | 1–5min poll | Free–$25/mo | MVP, hobbyist |
| **ESPN API** (unofficial) | 20+ leagues | Poll only | Free  | Prototyping only |
| **API-Football (RapidAPI)** | 900+ leagues | 30s–1min | $–$$  | Small/medium scale |

**Recommendation by phase:**
- **MVP / Prototype**: ESPN API (free) or Football-Data.org ($25/mo)
- **Beta / 10k users**: API-Football Pro ($100/mo)
- **Scale / 1M+ users**: SportRadar or Stats Perform (contract, $10k+/yr)

> FotMob itself uses **Stats Perform** for all match data, stats, and player ratings.

---

## 2. Canonical Data Model

Always normalise third-party data into your internal types immediately on ingestion. Never let provider-specific schemas leak into your services.

```typescript
// packages/shared/src/types/canonical.ts

export interface CanonicalLeague {
  internalId: string;
  externalIds: Record<string, string>;  // { statsPerform: '123', sportradar: 'sr:league:456' }
  name: string;
  country: string;
  tier: number;
}

export interface CanonicalTeam {
  internalId: string;
  externalIds: Record<string, string>;
  name: string;
  shortName: string;
  logoUrl: string;
}

export interface CanonicalMatch {
  internalId: string;
  externalIds: Record<string, string>;
  leagueId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  status: MatchStatus;
  minute: number | null;
  kickoffTime: Date;
  venue: string;
}

export interface CanonicalEvent {
  internalId: string;
  externalId: string;
  matchId: string;
  type: EventType;
  minute: number;
  addedTime?: number;
  teamId: string;
  playerId: string;
  assistPlayerId?: string;
  detail?: string;
  scoreAfter?: { home: number; away: number };
}
```

**ID mapping table** — keep a lookup table to map each provider's IDs to your internal IDs:
```sql
CREATE TABLE external_id_map (
  internal_id  TEXT NOT NULL,
  entity_type  TEXT NOT NULL,   -- 'match', 'team', 'player', 'league'
  provider     TEXT NOT NULL,   -- 'statsperform', 'sportradar', 'espn'
  external_id  TEXT NOT NULL,
  PRIMARY KEY (provider, entity_type, external_id),
  INDEX (internal_id)
);
```

---

## 3. Stats Perform / Opta Integration

Stats Perform delivers data via **AMQP push feed** (RabbitMQ-compatible) and REST APIs.

### Connecting to the push feed
```typescript
import amqp from 'amqplib';

const FEED_URL = process.env.STATS_PERFORM_AMQP_URL!;  // amqps://...

async function connectFeed(): Promise<void> {
  const conn = await amqp.connect(FEED_URL);
  const channel = await conn.createChannel();

  // Queue provided by Stats Perform per client
  const queue = process.env.STATS_PERFORM_QUEUE!;
  await channel.assertQueue(queue, { durable: true });

  console.log('Connected to Stats Perform feed, waiting for messages...');

  channel.consume(queue, async (msg) => {
    if (!msg) return;
    try {
      const raw = JSON.parse(msg.content.toString());
      const event = normaliseStatsPerform(raw);
      await processEvent(event);
      channel.ack(msg);
    } catch (err) {
      console.error('Failed to process message', err);
      channel.nack(msg, false, true);  // requeue once
    }
  });

  conn.on('close', () => {
    console.warn('AMQP connection closed, reconnecting in 5s...');
    setTimeout(connectFeed, 5000);
  });
}
```

### Stats Perform event normalisation
```typescript
// The raw Opta F9 / F24 feed format
interface OptaF24Event {
  "@id": string;
  "@event_id": string;
  "@type_id": string;    // '1' = pass, '16' = goal, '17' = card, etc.
  "@period_id": string;
  "@min": string;
  "@sec": string;
  "@team_id": string;
  "@player_id": string;
  "@outcome": string;
  "Q"?: Array<{ "@id": string; "@value": string }>;  // qualifiers
}

const OPTA_EVENT_TYPE_MAP: Record<string, EventType | null> = {
  '16': 'GOAL',
  '55': 'OWN_GOAL',
  '17': 'YELLOW_CARD',
  '72': 'SECOND_YELLOW',
  '76': 'RED_CARD',
  '18': 'SUBSTITUTION',
  '15': 'PENALTY_MISSED',
};

export function normaliseStatsPerform(raw: OptaF24Event): CanonicalEvent | null {
  const type = OPTA_EVENT_TYPE_MAP[raw['@type_id']];
  if (!type) return null;  // event type we don't care about

  const qualifiers = Object.fromEntries(
    (raw['Q'] ?? []).map(q => [q['@id'], q['@value']])
  );

  return {
    internalId: `sp-${raw['@event_id']}`,
    externalId: raw['@event_id'],
    matchId: resolveInternalId('match', 'statsperform', raw['@id']),
    type,
    minute: parseInt(raw['@min']),
    addedTime: raw['@sec'] ? Math.floor(parseInt(raw['@sec']) / 60) : undefined,
    teamId: resolveInternalId('team', 'statsperform', raw['@team_id']),
    playerId: resolveInternalId('player', 'statsperform', raw['@player_id']),
    assistPlayerId: qualifiers['55']
      ? resolveInternalId('player', 'statsperform', qualifiers['55'])
      : undefined,
    detail: qualifiers['72'] ?? undefined,  // shot type qualifier
  };
}
```

---

## 4. SportRadar Integration

SportRadar uses **HTTP webhooks** (push) and REST APIs. Register your endpoint in their dashboard.

### Webhook receiver
```typescript
import { FastifyPluginAsync } from 'fastify';
import crypto from 'crypto';

export const sportRadarWebhook: FastifyPluginAsync = async (fastify) => {
  fastify.post('/webhooks/sportradar', {
    config: { rawBody: true }  // needed for HMAC verification
  }, async (req, reply) => {
    // Verify HMAC signature
    const signature = req.headers['x-sportradar-signature'] as string;
    const expected = crypto
      .createHmac('sha256', process.env.SPORTRADAR_SECRET!)
      .update(req.rawBody!)
      .digest('hex');

    if (signature !== `sha256=${expected}`) {
      return reply.code(401).send({ error: 'Invalid signature' });
    }

    const raw = req.body as SportRadarEvent;
    const event = normaliseSportRadar(raw);
    if (event) await processEvent(event);

    return { ok: true };
  });
};

// SportRadar event normalisation
interface SportRadarEvent {
  metadata: { operation: string; change_type: string };
  payload: {
    game: { id: string };
    event: {
      id: string;
      type: string;     // 'scorechange', 'yellowcard', 'redcard', etc.
      clock: { played: string };
      competitor: string;  // 'home' | 'away'
      players: Array<{ id: string; type: string }>;
      home_score: number;
      away_score: number;
    };
  };
}

const SR_EVENT_TYPE_MAP: Record<string, EventType | null> = {
  'scorechange': 'GOAL',
  'yellowcard': 'YELLOW_CARD',
  'yellowredcard': 'SECOND_YELLOW',
  'redcard': 'RED_CARD',
  'substitution': 'SUBSTITUTION',
};

export function normaliseSportRadar(raw: SportRadarEvent): CanonicalEvent | null {
  const e = raw.payload.event;
  const type = SR_EVENT_TYPE_MAP[e.type];
  if (!type) return null;

  const scorer = e.players.find(p => p.type === 'scorer');
  const assistant = e.players.find(p => p.type === 'assist');

  return {
    internalId: `sr-${e.id}`,
    externalId: e.id,
    matchId: resolveInternalId('match', 'sportradar', raw.payload.game.id),
    type,
    minute: parseInt(e.clock.played.split(':')[0]),
    teamId: resolveInternalId('team', 'sportradar', e.competitor),  // map 'home'/'away' to ID
    playerId: resolveInternalId('player', 'sportradar', scorer?.id ?? ''),
    assistPlayerId: assistant
      ? resolveInternalId('player', 'sportradar', assistant.id)
      : undefined,
    scoreAfter: { home: e.home_score, away: e.away_score },
  };
}
```

---

## 5. ESPN API (Free Tier / MVP)

No auth required. Polling only — no push. Rate limit: ~100 req/hour.

```typescript
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

// Leagues and their ESPN IDs
const ESPN_LEAGUES: Record<string, string> = {
  premier_league: 'eng.1',
  la_liga: 'esp.1',
  bundesliga: 'ger.1',
  serie_a: 'ita.1',
  ligue_1: 'fra.1',
  champions_league: 'UEFA.CHAMPIONS',
};

// Fetch all matches for a league on a date
async function fetchESPNMatches(leagueSlug: string, date: string) {
  const leagueId = ESPN_LEAGUES[leagueSlug];
  const url = `${ESPN_BASE}/${leagueId}/scoreboard?dates=${date.replace(/-/g, '')}`;
  const res = await fetch(url);
  const data = await res.json();

  return data.events.map(normaliseESPN);
}

function normaliseESPN(event: any): CanonicalMatch {
  const competition = event.competitions[0];
  const home = competition.competitors.find((c: any) => c.homeAway === 'home');
  const away = competition.competitors.find((c: any) => c.homeAway === 'away');

  return {
    internalId: `espn-${event.id}`,
    externalIds: { espn: event.id },
    leagueId: 'TODO',  // map from league context
    homeTeamId: `espn-team-${home.team.id}`,
    awayTeamId: `espn-team-${away.team.id}`,
    homeScore: parseInt(home.score ?? '0'),
    awayScore: parseInt(away.score ?? '0'),
    status: mapESPNStatus(competition.status.type.name),
    minute: parseInt(competition.status.displayClock ?? '0') || null,
    kickoffTime: new Date(event.date),
    venue: competition.venue?.fullName ?? '',
  };
}

function mapESPNStatus(espnStatus: string): MatchStatus {
  const map: Record<string, MatchStatus> = {
    'STATUS_SCHEDULED': 'SCHEDULED',
    'STATUS_IN_PROGRESS': 'LIVE',
    'STATUS_HALFTIME': 'HALFTIME',
    'STATUS_FINAL': 'FINISHED',
    'STATUS_POSTPONED': 'POSTPONED',
  };
  return map[espnStatus] ?? 'SCHEDULED';
}

// Polling loop — runs every 30s during active matches
export function startPolling(): void {
  const POLL_INTERVAL = 30_000;
  const leagues = Object.keys(ESPN_LEAGUES);

  setInterval(async () => {
    const today = new Date().toISOString().split('T')[0];
    for (const league of leagues) {
      try {
        const matches = await fetchESPNMatches(league, today);
        for (const match of matches.filter(m => m.status === 'LIVE')) {
          await updateMatchState(match);
        }
      } catch (err) {
        console.error(`Poll failed for ${league}:`, err);
      }
    }
  }, POLL_INTERVAL);
}
```

---

## 6. Ingestion Lambda

AWS Lambda function that receives webhook events from providers, validates, normalises, and hands off.

```typescript
// infrastructure/lambda/ingestion.ts
import { APIGatewayProxyHandler } from 'aws-lambda';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({ region: process.env.AWS_REGION });

export const handler: APIGatewayProxyHandler = async (event) => {
  const provider = event.pathParameters?.provider;   // /webhooks/{provider}
  const body = JSON.parse(event.body ?? '{}');

  // 1. Verify signature per provider
  const valid = verifySignature(provider!, event.headers, event.body!);
  if (!valid) return { statusCode: 401, body: 'Unauthorized' };

  // 2. Normalise to canonical event
  let canonical: CanonicalEvent | null = null;
  if (provider === 'statsperform') canonical = normaliseStatsPerform(body);
  if (provider === 'sportradar')   canonical = normaliseSportRadar(body);
  if (!canonical) return { statusCode: 200, body: 'Ignored' };

  // 3. Send to processing queue
  await sqs.send(new SendMessageCommand({
    QueueUrl: process.env.EVENT_QUEUE_URL,
    MessageBody: JSON.stringify(canonical),
    MessageGroupId: canonical.matchId,   // FIFO — events per match stay ordered
  }));

  return { statusCode: 200, body: 'OK' };
};
```

---

## 7. Normalisation Layer

Central module shared by all provider adaptors.

```typescript
// packages/shared/src/normalisation/resolve-id.ts
import { prisma } from '../db';

// Resolve provider external ID → internal UUID
// With in-memory LRU cache to avoid DB hit on every event
import { LRUCache } from 'lru-cache';

const cache = new LRUCache<string, string>({ max: 50_000, ttl: 1000 * 60 * 60 });

export async function resolveInternalId(
  entityType: 'match' | 'team' | 'player' | 'league',
  provider: string,
  externalId: string,
): Promise<string> {
  const cacheKey = `${provider}:${entityType}:${externalId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const row = await prisma.externalIdMap.findUnique({
    where: { provider_entityType_externalId: { provider, entityType, externalId } },
  });

  if (!row) throw new Error(`No mapping found for ${provider}/${entityType}/${externalId}`);

  cache.set(cacheKey, row.internalId);
  return row.internalId;
}
```

---

## 8. Reliability & Error Handling

### Dead letter queue for failed events
```typescript
// Any event that fails processing 3 times → dead letter queue
// Monitor DLQ size — alert if > 0 (should always be empty in healthy system)

// DLQ consumer for manual investigation + replay
const dlqConsumer = async () => {
  const msg = await sqs.receive(DLQ_URL);
  if (!msg) return;

  console.error('DLQ event — investigate:', JSON.parse(msg.Body!));
  // Notify on-call via PagerDuty
  await pagerduty.createIncident({
    title: `Ingestion failure: ${JSON.parse(msg.Body!).type}`,
    severity: 'warning',
  });
};
```

### Idempotency — prevent duplicate processing
```typescript
// Use externalId as idempotency key
async function processEvent(event: CanonicalEvent): Promise<void> {
  const existing = await prisma.matchEvent.findUnique({
    where: { externalId: event.externalId }
  });
  if (existing) {
    console.log(`Duplicate event ${event.externalId} — skipping`);
    return;
  }
  // ... proceed with processing
}
```

### Provider health check
```typescript
// Run every minute — alert if provider hasn't sent events for a live match in > 2 min
export async function checkProviderHealth(): Promise<void> {
  const liveMatches = await prisma.match.findMany({ where: { status: 'LIVE' } });
  for (const match of liveMatches) {
    const lastEvent = await prisma.matchEvent.findFirst({
      where: { matchId: match.id },
      orderBy: { createdAt: 'desc' },
    });
    const silentFor = Date.now() - (lastEvent?.createdAt.getTime() ?? match.kickoffTime.getTime());
    if (silentFor > 2 * 60 * 1000) {
      console.warn(`No events for live match ${match.id} in ${silentFor / 1000}s`);
      await alertOncall(`Provider silent for match ${match.id}`);
    }
  }
}
```

---

## 9. Data Sync & Backfill Jobs

Scheduled jobs that keep the DB in sync with the provider's full dataset.

```typescript
// Runs nightly at 2am — sync fixtures for next 7 days
export async function syncFixtures(): Promise<void> {
  const leagues = await prisma.league.findMany({ where: { isActive: true } });

  for (const league of leagues) {
    const fixtures = await provider.getFixtures(league.externalIds.statsperform, 7);
    for (const fixture of fixtures) {
      await prisma.match.upsert({
        where: { externalId: fixture.externalId },
        create: normaliseMatch(fixture),
        update: {
          kickoffTime: fixture.kickoffTime,
          status: fixture.status,
          venue: fixture.venue,
        },
      });
    }
  }
}

// Runs at full-time + 10 min — backfill final stats for a finished match
export async function backfillMatchStats(matchId: string): Promise<void> {
  const match = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });
  const externalId = match.externalIds.statsperform;

  const [stats, events] = await Promise.all([
    provider.getMatchStats(externalId),
    provider.getMatchEvents(externalId),
  ]);

  await prisma.matchStats.upsert({
    where: { matchId },
    create: { matchId, ...normaliseStats(stats) },
    update: normaliseStats(stats),
  });

  // Also compute and store player ratings
  await computeAndStorePlayerRatings(matchId, events);
}
```

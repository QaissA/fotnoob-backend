# Backend Reference — Node.js Microservices

Full implementation guide for all backend services. Every service is TypeScript, containerised with Docker, deployed on AWS EKS.

---

## Table of Contents
1. [Monorepo Setup](#1-monorepo-setup)
2. [Shared Types & Contracts](#2-shared-types--contracts)
3. [Scores Service](#3-scores-service)
4. [Stats Service](#4-stats-service)
5. [User Service](#5-user-service)
6. [News Service](#6-news-service)
7. [Search Service](#7-search-service)
8. [WebSocket Hub](#8-websocket-hub)
9. [API Gateway (Lambda)](#9-api-gateway-lambda)
10. [Service Communication Patterns](#10-service-communication-patterns)

---

## 1. Monorepo Setup

Use **pnpm workspaces** + **Turborepo** for a monorepo that shares types across all services.

```
fotmob-backend/
├── package.json               # root — pnpm workspace config
├── turbo.json                 # Turborepo pipeline
├── packages/
│   └── shared/                # @fotmob/shared — DTOs, types, utils
│       ├── src/
│       │   ├── types/
│       │   │   ├── match.ts
│       │   │   ├── player.ts
│       │   │   ├── league.ts
│       │   │   └── events.ts
│       │   └── index.ts
│       └── package.json
├── services/
│   ├── scores/
│   ├── stats/
│   ├── user/
│   ├── news/
│   ├── search/
│   ├── notifications/
│   └── ws-hub/
└── infrastructure/            # CDK code lives here
```

```json
// root package.json
{
  "private": true,
  "workspaces": ["packages/*", "services/*"],
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev --parallel",
    "test": "turbo run test"
  }
}
```

Each service's `package.json` depends on `@fotmob/shared`:
```json
{
  "dependencies": {
    "@fotmob/shared": "workspace:*"
  }
}
```

### Base service scaffold

Every service uses this stack:
- **Fastify** (not Express — 2× throughput, built-in schema validation)
- **Prisma** ORM (Aurora PostgreSQL)
- **ioredis** (ElastiCache)
- **Zod** (runtime validation)
- **Pino** (structured JSON logging)

```bash
# Per service
npm init -y
npm install fastify @fastify/cors @fastify/jwt @fastify/rate-limit
npm install prisma @prisma/client ioredis
npm install zod pino pino-pretty
npm install -D typescript ts-node @types/node nodemon
```

---

## 2. Shared Types & Contracts

Define once in `@fotmob/shared`, use everywhere — backend services, Angular, and via code-gen in Flutter.

```typescript
// packages/shared/src/types/match.ts

export type MatchStatus = 'SCHEDULED' | 'LIVE' | 'HALFTIME' | 'FINISHED' | 'POSTPONED';

export interface Team {
  id: string;
  name: string;
  shortName: string;      // 'ARS', 'CHE'
  logoUrl: string;
  countryCode: string;
}

export interface Match {
  id: string;
  leagueId: string;
  leagueName: string;
  homeTeam: Team;
  awayTeam: Team;
  homeScore: number;
  awayScore: number;
  status: MatchStatus;
  minute: number | null;   // null when not live
  kickoffTime: string;     // ISO 8601
  venue: string;
  round: string;
}

export interface MatchEvent {
  id: string;
  matchId: string;
  type: 'GOAL' | 'YELLOW_CARD' | 'RED_CARD' | 'SUBSTITUTION' | 'VAR' | 'PENALTY_MISSED';
  minute: number;
  addedTime?: number;
  teamId: string;
  playerId: string;
  playerName: string;
  assistPlayerId?: string;
  assistPlayerName?: string;
  detail?: string;          // 'Header', 'Left foot', 'Own goal'
  score?: { home: number; away: number };
}

export interface MatchStats {
  matchId: string;
  possession: { home: number; away: number };
  shots: { home: number; away: number };
  shotsOnTarget: { home: number; away: number };
  corners: { home: number; away: number };
  fouls: { home: number; away: number };
  yellowCards: { home: number; away: number };
  redCards: { home: number; away: number };
  xG: { home: number; away: number };
}

// WebSocket message envelope
export interface WSMessage {
  type: 'SUBSCRIBE' | 'UNSUBSCRIBE' | 'MATCH_EVENT' | 'MATCH_UPDATE' | 'PING';
  matchId?: string;
  payload?: MatchEvent | Match;
}
```

---

## 3. Scores Service

The highest-traffic service. Serves all match listings, live scores, league tables.

### File structure
```
services/scores/src/
├── index.ts             # Fastify server bootstrap
├── routes/
│   ├── matches.ts       # GET /matches?date=
│   ├── match.ts         # GET /matches/:id
│   └── leagues.ts       # GET /leagues/:id/table, /leagues/:id/fixtures
├── handlers/
│   └── event-ingestion.ts  # Webhook from data provider
├── services/
│   ├── match.service.ts
│   └── league.service.ts
├── cache/
│   └── redis.ts
└── db/
    └── prisma.ts
```

### Server bootstrap
```typescript
// services/scores/src/index.ts
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { matchesRoutes } from './routes/matches';
import { leaguesRoutes } from './routes/leagues';

const server = Fastify({ logger: { level: 'info' } });

server.register(cors, { origin: process.env.ALLOWED_ORIGINS?.split(',') });
server.register(jwt, { secret: process.env.JWT_SECRET! });
server.register(rateLimit, { max: 200, timeWindow: '1 minute' });

server.register(matchesRoutes, { prefix: '/matches' });
server.register(leaguesRoutes, { prefix: '/leagues' });

server.listen({ port: 3001, host: '0.0.0.0' });
```

### Matches route with caching
```typescript
// services/scores/src/routes/matches.ts
import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { redis } from '../cache/redis';
import { MatchService } from '../services/match.service';

const querySchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

export const matchesRoutes: FastifyPluginAsync = async (fastify) => {
  const matchService = new MatchService();

  fastify.get('/', async (req, reply) => {
    const { date } = querySchema.parse(req.query);
    const cacheKey = `matches:${date}`;

    // Check Redis cache
    const cached = await redis.get(cacheKey);
    if (cached) {
      return reply.header('X-Cache', 'HIT').send(JSON.parse(cached));
    }

    const matches = await matchService.getByDate(date);
    const grouped = matchService.groupByLeague(matches);

    // Cache: 30s for today (live), 1h for past/future
    const isToday = date === new Date().toISOString().split('T')[0];
    await redis.setex(cacheKey, isToday ? 30 : 3600, JSON.stringify(grouped));

    return reply.header('X-Cache', 'MISS').send(grouped);
  });

  // Webhook endpoint — called by data provider on match events
  fastify.post('/events', {
    onRequest: [fastify.authenticate],  // verify provider HMAC signature
  }, async (req, reply) => {
    const event = req.body as MatchEvent;
    await matchService.processEvent(event);
    return { ok: true };
  });
};
```

### Event processing + Redis pub/sub
```typescript
// services/scores/src/services/match.service.ts
export class MatchService {
  async processEvent(event: MatchEvent): Promise<void> {
    // 1. Normalise to canonical MatchEvent type
    const canonical = this.normalise(event);

    // 2. Update match state in Aurora
    await prisma.matchEvent.create({ data: canonical });
    await this.updateMatchScore(canonical);

    // 3. Invalidate caches
    const date = await this.getMatchDate(canonical.matchId);
    await redis.del(`matches:${date}`);
    await redis.del(`match:${canonical.matchId}`);

    // 4. Publish to Redis pub/sub → WS Hub + Notifications service pick this up
    await redis.publish('match-events', JSON.stringify(canonical));
  }
}
```

---

## 4. Stats Service

Computes and serves advanced stats. Runs heavier batch jobs post-match.

### Key endpoints
```
GET /matches/:id/stats        → MatchStats (shots, possession, xG)
GET /matches/:id/momentum     → MomentumPoint[]  (rolling xG by minute)
GET /players/:id              → Player profile + season stats
GET /players/:id/heatmap      → HeatmapData (grid of touch positions)
GET /teams/:id                → Team profile + season stats
GET /teams/:id/form           → Last 5 results
```

### xG computation (Lambda function)
```typescript
// Simplified xG model — weights based on shot attributes
export function computeXG(shot: ShotEvent): number {
  let xg = 0.08;  // base rate

  // Distance from goal (metres)
  if (shot.distance < 6) xg += 0.35;
  else if (shot.distance < 11) xg += 0.15;
  else if (shot.distance < 16) xg += 0.05;
  else xg -= 0.04;

  // Angle (degrees from centre)
  if (shot.angle > 30) xg += 0.06;
  else if (shot.angle < 10) xg -= 0.05;

  // Type
  if (shot.bodyPart === 'head') xg -= 0.04;
  if (shot.isAssisted) xg += 0.07;
  if (shot.followingCorner) xg -= 0.02;

  return Math.max(0.01, Math.min(0.99, xg));
}
```

### Player rating system
```typescript
// Weighted event contributions → 0-10 rating
const WEIGHTS: Record<string, number> = {
  GOAL: 2.0,
  ASSIST: 1.2,
  KEY_PASS: 0.5,
  SHOT_ON_TARGET: 0.3,
  TACKLE_WON: 0.3,
  INTERCEPTION: 0.2,
  CLEARANCE: 0.15,
  DRIBBLE_SUCCESS: 0.2,
  YELLOW_CARD: -0.5,
  RED_CARD: -1.5,
  GOAL_CONCEDED: -0.4,   // GK/DEF
  SAVE: 0.6,              // GK
};

export function computePlayerRating(events: PlayerEvent[]): number {
  const base = 6.0;
  const contribution = events.reduce((sum, e) => sum + (WEIGHTS[e.type] ?? 0), 0);
  return Math.max(1, Math.min(10, base + contribution));
}
```

---

## 5. User Service

Handles auth, favourites, and notification preferences.

### JWT auth flow
```typescript
// POST /auth/login
fastify.post('/auth/login', async (req, reply) => {
  const { email, password } = req.body as LoginDTO;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !await bcrypt.compare(password, user.passwordHash)) {
    return reply.code(401).send({ error: 'Invalid credentials' });
  }

  const accessToken = fastify.jwt.sign(
    { userId: user.id, email: user.email },
    { expiresIn: '15m' }
  );
  const refreshToken = fastify.jwt.sign(
    { userId: user.id, type: 'refresh' },
    { expiresIn: '30d' }
  );

  // Store refresh token hash in DB (for revocation)
  await prisma.refreshToken.create({
    data: { userId: user.id, tokenHash: await bcrypt.hash(refreshToken, 10) }
  });

  return { accessToken, refreshToken, user: { id: user.id, email: user.email } };
});
```

### Favourites management
```typescript
// PUT /users/me/favourites
fastify.put('/favourites', { onRequest: [authenticate] }, async (req, reply) => {
  const { teamIds, leagueIds, playerIds } = req.body as FavouritesDTO;
  const userId = req.user.userId;

  await prisma.userFavourites.upsert({
    where: { userId },
    create: { userId, teamIds, leagueIds, playerIds },
    update: { teamIds, leagueIds, playerIds },
  });

  // Sync notification subscriptions
  await notificationService.syncSubscriptions(userId, teamIds);

  return { ok: true };
});
```

---

## 6. News Service

Ingests articles from RSS feeds, stores them, triggers AI summary generation.

```typescript
// Ingestion job — runs every 5 minutes via cron
export async function ingestFeeds(): Promise<void> {
  const feeds = await prisma.newsFeed.findMany({ where: { active: true } });

  await Promise.allSettled(feeds.map(async (feed) => {
    const items = await parseFeed(feed.url);   // rss-parser library

    for (const item of items) {
      const exists = await prisma.article.findUnique({ where: { sourceUrl: item.link } });
      if (exists) continue;

      const article = await prisma.article.create({
        data: {
          title: item.title!,
          sourceUrl: item.link!,
          publishedAt: new Date(item.pubDate!),
          teamId: feed.teamId,
          leagueId: feed.leagueId,
          rawContent: item.contentSnippet ?? '',
          status: 'PENDING_SUMMARY',
        }
      });

      // Queue AI summary generation (async, non-blocking)
      await summaryQueue.add('generate-summary', { articleId: article.id });
    }
  }));
}
```

---

## 7. Search Service

OpenSearch (AWS managed) for fuzzy search across teams, players, leagues, matches.

```typescript
import { Client } from '@opensearch-project/opensearch';

const client = new Client({ node: process.env.OPENSEARCH_URL });

// Index a player on creation/update
export async function indexPlayer(player: Player): Promise<void> {
  await client.index({
    index: 'players',
    id: player.id,
    body: {
      name: player.name,
      team: player.team.name,
      nationality: player.nationality,
      position: player.position,
      suggest: {               // completion suggester for autocomplete
        input: [player.name, ...player.name.split(' ')],
        weight: player.popularityScore,
      },
    },
  });
}

// Search endpoint
fastify.get('/search', async (req, reply) => {
  const { q } = req.query as { q: string };

  const [players, teams, leagues] = await Promise.all([
    client.search({ index: 'players', body: {
      query: { multi_match: { query: q, fields: ['name^3', 'team'], fuzziness: 'AUTO' } },
      size: 5,
    }}),
    client.search({ index: 'teams', body: {
      query: { match: { name: { query: q, fuzziness: 'AUTO' } } },
      size: 3,
    }}),
    client.search({ index: 'leagues', body: {
      query: { match: { name: { query: q, fuzziness: 'AUTO' } } },
      size: 3,
    }}),
  ]);

  return {
    players: players.body.hits.hits.map((h: any) => h._source),
    teams: teams.body.hits.hits.map((h: any) => h._source),
    leagues: leagues.body.hits.hits.map((h: any) => h._source),
  };
});
```

---

## 8. WebSocket Hub

Stateless WS servers. Clients subscribe to match rooms. Fan-out via Redis pub/sub.

```typescript
// services/ws-hub/src/index.ts
import { WebSocketServer, WebSocket } from 'ws';
import { redis, redisSub } from './redis';
import type { WSMessage } from '@fotmob/shared';

const wss = new WebSocketServer({ port: 8080 });

// Map: matchId → Set of connected WebSocket clients
const rooms = new Map<string, Set<WebSocket>>();

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    const msg: WSMessage = JSON.parse(raw.toString());

    if (msg.type === 'SUBSCRIBE' && msg.matchId) {
      if (!rooms.has(msg.matchId)) rooms.set(msg.matchId, new Set());
      rooms.get(msg.matchId)!.add(ws);
      (ws as any).__rooms = [...((ws as any).__rooms ?? []), msg.matchId];
    }

    if (msg.type === 'UNSUBSCRIBE' && msg.matchId) {
      rooms.get(msg.matchId)?.delete(ws);
    }

    if (msg.type === 'PING') ws.send(JSON.stringify({ type: 'PONG' }));
  });

  ws.on('close', () => {
    // Cleanup: remove from all rooms
    for (const matchId of (ws as any).__rooms ?? []) {
      rooms.get(matchId)?.delete(ws);
    }
  });
});

// Subscribe to Redis — receives events published by Scores service
redisSub.subscribe('match-events');
redisSub.on('message', (_, data) => {
  const event: MatchEvent = JSON.parse(data);
  const room = rooms.get(event.matchId);
  if (!room?.size) return;

  const payload = JSON.stringify({ type: 'MATCH_EVENT', payload: event });
  for (const client of room) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
});
```

**Scaling WS Hub across multiple instances:** Each instance subscribes to the same Redis channel independently. All instances receive all events and fan out to their local clients. No inter-instance coordination needed.

---

## 9. API Gateway (Lambda)

AWS Lambda functions that sit in front of services. Handle auth verification, routing, rate limiting at the edge.

```typescript
// infrastructure/lambda/api-gateway.ts
import { APIGatewayProxyHandler } from 'aws-lambda';
import jwt from 'jsonwebtoken';

export const handler: APIGatewayProxyHandler = async (event) => {
  const path = event.path;
  const method = event.httpMethod;

  // Auth check for protected routes
  if (path.startsWith('/users/me')) {
    const token = event.headers.Authorization?.replace('Bearer ', '');
    if (!token) return { statusCode: 401, body: 'Unauthorized' };
    try {
      jwt.verify(token, process.env.JWT_SECRET!);
    } catch {
      return { statusCode: 401, body: 'Invalid token' };
    }
  }

  // Route to target service (internal EKS DNS)
  const serviceMap: Record<string, string> = {
    '/matches': 'http://scores-service:3001',
    '/leagues': 'http://scores-service:3001',
    '/players': 'http://stats-service:3002',
    '/teams': 'http://stats-service:3002',
    '/users': 'http://user-service:3003',
    '/news': 'http://news-service:3004',
    '/search': 'http://search-service:3005',
  };

  const prefix = '/' + path.split('/')[1];
  const target = serviceMap[prefix];
  if (!target) return { statusCode: 404, body: 'Not found' };

  // Proxy request
  const res = await fetch(`${target}${path}`, {
    method,
    headers: event.headers as HeadersInit,
    body: event.body ?? undefined,
  });

  return {
    statusCode: res.status,
    headers: { 'Content-Type': 'application/json' },
    body: await res.text(),
  };
};
```

---

## 10. Service Communication Patterns

| Pattern | When to use | Implementation |
|---------|------------|----------------|
| Sync HTTP | Client-facing reads (scores, stats, news) | Fastify → fetch |
| Redis pub/sub | Match events → WS hub, notifications | `redis.publish` / `redis.subscribe` |
| SQS queue | Notification fan-out, AI summary jobs | `@aws-sdk/client-sqs` |
| Shared DB | Cross-service joins (avoid!) | Only for reporting; use IDs + separate calls in app |

### Redis pub/sub channels
| Channel | Publisher | Subscribers |
|---------|-----------|-------------|
| `match-events` | Scores service | WS Hub, Notifications service |
| `match-finished` | Scores service | Stats service (trigger batch), News service |
| `user-registered` | User service | Notifications service (subscribe to default leagues) |

### Error handling pattern (all services)
```typescript
// Wrap all route handlers with this
fastify.setErrorHandler((error, req, reply) => {
  fastify.log.error({ err: error, url: req.url }, 'Request error');

  if (error.validation) {
    return reply.code(400).send({ error: 'Validation failed', details: error.validation });
  }
  if (error.statusCode) {
    return reply.code(error.statusCode).send({ error: error.message });
  }
  return reply.code(500).send({ error: 'Internal server error' });
});
```

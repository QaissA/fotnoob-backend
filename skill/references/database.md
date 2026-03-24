# Database Reference — Aurora + Redis

Schema design, query patterns, caching strategy, and migrations for the FotMob-clone data layer.

---

## Table of Contents
1. [Aurora PostgreSQL Schema (Prisma)](#1-aurora-postgresql-schema-prisma)
2. [Key Query Patterns](#2-key-query-patterns)
3. [Redis Caching Patterns](#3-redis-caching-patterns)
4. [Database Indexes](#4-database-indexes)
5. [Migrations Strategy](#5-migrations-strategy)
6. [Multi-Region Setup](#6-multi-region-setup)
7. [Connection Pooling](#7-connection-pooling)

---

## 1. Aurora PostgreSQL Schema (Prisma)

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── LEAGUES & COMPETITIONS ────────────────────────────────────────────────

model League {
  id          String   @id @default(cuid())
  externalId  String   @unique   // provider's ID (e.g. Stats Perform league ID)
  name        String
  shortName   String
  country     String
  logoUrl     String?
  tier        Int      @default(1)   // 1 = top flight, 2 = second div
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  seasons     Season[]
  newsFeed    NewsFeed?

  @@index([country])
  @@index([isActive])
}

model Season {
  id          String   @id @default(cuid())
  leagueId    String
  name        String   // '2024/25'
  startDate   DateTime
  endDate     DateTime
  isCurrent   Boolean  @default(false)

  league      League   @relation(fields: [leagueId], references: [id])
  matches     Match[]
  standings   Standing[]

  @@index([leagueId, isCurrent])
}

// ─── TEAMS ─────────────────────────────────────────────────────────────────

model Team {
  id          String   @id @default(cuid())
  externalId  String   @unique
  name        String
  shortName   String   // 'ARS'
  logoUrl     String?
  countryCode String
  founded     Int?
  stadium     String?
  website     String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  homeMatches     Match[]        @relation("HomeTeam")
  awayMatches     Match[]        @relation("AwayTeam")
  players         Player[]
  standings       Standing[]
  userFavourites  UserFavouriteTeam[]

  @@index([countryCode])
}

// ─── PLAYERS ───────────────────────────────────────────────────────────────

model Player {
  id              String    @id @default(cuid())
  externalId      String    @unique
  name            String
  dateOfBirth     DateTime?
  nationality     String?
  position        String?   // 'GK', 'DEF', 'MID', 'FWD'
  jerseyNumber    Int?
  photoUrl        String?
  popularityScore Int       @default(0)   // used for search ranking
  teamId          String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  team            Team?     @relation(fields: [teamId], references: [id])
  matchEvents     MatchEvent[]
  ratings         PlayerMatchRating[]
  userFavourites  UserFavouritePlayer[]

  @@index([teamId])
  @@index([popularityScore])
}

// ─── MATCHES ───────────────────────────────────────────────────────────────

model Match {
  id           String      @id @default(cuid())
  externalId   String      @unique
  seasonId     String
  homeTeamId   String
  awayTeamId   String
  homeScore    Int         @default(0)
  awayScore    Int         @default(0)
  status       MatchStatus @default(SCHEDULED)
  minute       Int?        // null when not live
  kickoffTime  DateTime
  venue        String?
  round        String?     // 'Matchday 12', 'Quarter-final'
  attendance   Int?
  refereeId    String?
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt

  season       Season      @relation(fields: [seasonId], references: [id])
  homeTeam     Team        @relation("HomeTeam", fields: [homeTeamId], references: [id])
  awayTeam     Team        @relation("AwayTeam", fields: [awayTeamId], references: [id])
  events       MatchEvent[]
  stats        MatchStats?
  playerRatings PlayerMatchRating[]

  @@index([kickoffTime])
  @@index([status])
  @@index([homeTeamId])
  @@index([awayTeamId])
  @@index([seasonId, status])
}

enum MatchStatus {
  SCHEDULED
  LIVE
  HALFTIME
  FINISHED
  POSTPONED
  CANCELLED
}

model MatchEvent {
  id              String    @id @default(cuid())
  matchId         String
  type            EventType
  minute          Int
  addedTime       Int?
  teamId          String
  playerId        String
  assistPlayerId  String?
  detail          String?
  homeScoreAfter  Int?
  awayScoreAfter  Int?
  createdAt       DateTime  @default(now())

  match           Match     @relation(fields: [matchId], references: [id])
  player          Player    @relation(fields: [playerId], references: [id])

  @@index([matchId])
  @@index([playerId])
}

enum EventType {
  GOAL
  OWN_GOAL
  YELLOW_CARD
  SECOND_YELLOW
  RED_CARD
  SUBSTITUTION
  PENALTY_SCORED
  PENALTY_MISSED
  VAR_REVIEW
}

model MatchStats {
  id                  String  @id @default(cuid())
  matchId             String  @unique
  possessionHome      Float?
  possessionAway      Float?
  shotsHome           Int?
  shotsAway           Int?
  shotsOnTargetHome   Int?
  shotsOnTargetAway   Int?
  xGHome              Float?
  xGAway              Float?
  cornersHome         Int?
  cornersAway         Int?
  foulsHome           Int?
  foulsAway           Int?
  passAccuracyHome    Float?
  passAccuracyAway    Float?

  // Momentum: stored as JSON array of { minute, xGDelta }
  momentumData        Json?

  match               Match   @relation(fields: [matchId], references: [id])
}

model PlayerMatchRating {
  id        String  @id @default(cuid())
  playerId  String
  matchId   String
  rating    Float   // 1.0 – 10.0
  minutes   Int     // minutes played
  goals     Int     @default(0)
  assists   Int     @default(0)

  player    Player  @relation(fields: [playerId], references: [id])
  match     Match   @relation(fields: [matchId], references: [id])

  @@unique([playerId, matchId])
  @@index([playerId])
  @@index([matchId])
}

// ─── STANDINGS ─────────────────────────────────────────────────────────────

model Standing {
  id          String  @id @default(cuid())
  seasonId    String
  teamId      String
  position    Int
  played      Int     @default(0)
  won         Int     @default(0)
  drawn       Int     @default(0)
  lost        Int     @default(0)
  goalsFor    Int     @default(0)
  goalsAgainst Int    @default(0)
  points      Int     @default(0)
  form        String? // 'WWDLW'
  updatedAt   DateTime @updatedAt

  season      Season  @relation(fields: [seasonId], references: [id])
  team        Team    @relation(fields: [teamId], references: [id])

  @@unique([seasonId, teamId])
  @@index([seasonId, position])
}

// ─── USERS ─────────────────────────────────────────────────────────────────

model User {
  id           String    @id @default(cuid())
  email        String    @unique
  passwordHash String
  displayName  String?
  avatarUrl    String?
  locale       String    @default("en")
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  refreshTokens       RefreshToken[]
  favouriteTeams      UserFavouriteTeam[]
  favouriteLeagues    UserFavouriteLeague[]
  favouritePlayers    UserFavouritePlayer[]
  notificationPrefs   NotificationPrefs?
  fcmTokens           FcmToken[]
}

model UserFavouriteTeam {
  userId    String
  teamId    String
  addedAt   DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id])
  team      Team     @relation(fields: [teamId], references: [id])
  @@id([userId, teamId])
}

model UserFavouriteLeague {
  userId    String
  leagueId  String
  addedAt   DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id])
  @@id([userId, leagueId])
}

model UserFavouritePlayer {
  userId    String
  playerId  String
  addedAt   DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id])
  player    Player   @relation(fields: [playerId], references: [id])
  @@id([userId, playerId])
}

model NotificationPrefs {
  userId          String  @id
  goals           Boolean @default(true)
  kickoff         Boolean @default(true)
  lineups         Boolean @default(false)
  finalWhistle    Boolean @default(true)
  news            Boolean @default(false)
  user            User    @relation(fields: [userId], references: [id])
}

model FcmToken {
  id        String   @id @default(cuid())
  userId    String
  token     String   @unique
  platform  String   // 'android' | 'ios'
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id])
  @@index([userId])
}

model RefreshToken {
  id         String   @id @default(cuid())
  userId     String
  tokenHash  String
  expiresAt  DateTime
  revokedAt  DateTime?
  createdAt  DateTime @default(now())
  user       User     @relation(fields: [userId], references: [id])
  @@index([userId])
}

// ─── NEWS ──────────────────────────────────────────────────────────────────

model Article {
  id          String        @id @default(cuid())
  title       String
  sourceUrl   String        @unique
  imageUrl    String?
  rawContent  String        @db.Text
  aiSummary   String?       @db.Text
  teamId      String?
  leagueId    String?
  publishedAt DateTime
  status      ArticleStatus @default(PENDING_SUMMARY)
  createdAt   DateTime      @default(now())

  @@index([teamId, publishedAt])
  @@index([leagueId, publishedAt])
  @@index([publishedAt])
}

enum ArticleStatus {
  PENDING_SUMMARY
  SUMMARISED
  FAILED
}

model NewsFeed {
  id        String   @id @default(cuid())
  leagueId  String?  @unique
  teamId    String?
  url       String
  active    Boolean  @default(true)
  league    League?  @relation(fields: [leagueId], references: [id])
}
```

---

## 2. Key Query Patterns

### Get matches by date (most common query)
```typescript
// Prisma query with all needed relations — one round trip
const matches = await prisma.match.findMany({
  where: {
    kickoffTime: {
      gte: new Date(`${date}T00:00:00Z`),
      lt:  new Date(`${date}T23:59:59Z`),
    },
  },
  include: {
    homeTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } },
    awayTeam: { select: { id: true, name: true, shortName: true, logoUrl: true } },
    season: { select: { leagueId: true } },
  },
  orderBy: [{ kickoffTime: 'asc' }],
});
```

### Get league table (standings)
```typescript
const standings = await prisma.standing.findMany({
  where: { season: { leagueId, isCurrent: true } },
  include: { team: { select: { id: true, name: true, shortName: true, logoUrl: true } } },
  orderBy: [{ position: 'asc' }],
});
```

### Get users subscribed to a team (for notification fan-out)
```typescript
// Batched in pages of 1000 for fan-out — never load all at once
async function* getUsersForTeam(teamId: string) {
  let cursor: string | undefined;
  while (true) {
    const batch = await prisma.userFavouriteTeam.findMany({
      where: { teamId },
      include: { user: { include: { fcmTokens: true } } },
      take: 1000,
      ...(cursor ? { skip: 1, cursor: { userId_teamId: { userId: cursor, teamId } } } : {}),
    });
    if (batch.length === 0) break;
    yield batch;
    cursor = batch[batch.length - 1].userId;
  }
}
```

---

## 3. Redis Caching Patterns

### Key naming convention
```
matches:{date}               → grouped matches for a date (TTL: 30s live / 3600s past)
match:{id}                   → single match detail (TTL: 10s live / 3600s finished)
match:{id}:stats             → match stats (TTL: 30s live / 86400s finished)
match:{id}:events            → list of match events (TTL: 10s live / 86400s finished)
league:{id}:table            → league standings (TTL: 60s)
league:{id}:fixtures:{page}  → paginated fixtures (TTL: 300s)
player:{id}                  → player profile (TTL: 3600s)
player:{id}:season-stats     → player season stats (TTL: 3600s)
team:{id}                    → team profile (TTL: 3600s)
news:{teamId}:{page}         → news by team (TTL: 900s)
user:{id}:favourites         → user's favourites list (TTL: 300s, invalidate on PUT)
```

### Cache-aside helper
```typescript
// Generic cache-aside with TTL and JSON serialisation
export async function cachedFetch<T>(
  key: string,
  ttl: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached) as T;

  const data = await fetcher();
  await redis.setex(key, ttl, JSON.stringify(data));
  return data;
}

// Usage
const table = await cachedFetch(
  `league:${leagueId}:table`,
  60,
  () => prisma.standing.findMany({ where: { season: { leagueId, isCurrent: true } } })
);
```

### Cache invalidation on match events
```typescript
// When a GOAL event arrives, invalidate these keys
async function invalidateOnGoal(event: MatchEvent): Promise<void> {
  const date = event.kickoffTime.split('T')[0];
  await redis.del([
    `matches:${date}`,
    `match:${event.matchId}`,
    `match:${event.matchId}:stats`,
    `match:${event.matchId}:events`,
  ]);
}
```

### Pub/Sub channels
```typescript
// Publisher (Scores service)
await redis.publish('match-events', JSON.stringify(event));
await redis.publish('match-finished', JSON.stringify({ matchId, seasonId }));

// Subscriber (WS Hub, Notifications service — separate Redis connection required)
const sub = new Redis(process.env.REDIS_URL);
sub.subscribe('match-events', 'match-finished');
sub.on('message', (channel, message) => { /* handle */ });
```

> **Important:** Publishing and subscribing use the same Redis instance, but you must use **separate Redis client connections** — a client in subscribe mode cannot issue other commands.

---

## 4. Database Indexes

Critical indexes beyond the ones in the schema (add these manually if needed):

```sql
-- Matches by date range + status (most frequent query)
CREATE INDEX idx_matches_kickoff_status ON "Match" ("kickoffTime", "status");

-- Match events ordered by minute (for timeline rendering)
CREATE INDEX idx_events_match_minute ON "MatchEvent" ("matchId", "minute");

-- Standings ordered by position in a season (league table)
CREATE INDEX idx_standings_season_pos ON "Standing" ("seasonId", "position");

-- Articles newest-first per team
CREATE INDEX idx_articles_team_date ON "Article" ("teamId", "publishedAt" DESC);

-- FCM token lookup by user
CREATE INDEX idx_fcm_user ON "FcmToken" ("userId");

-- Full-text search on player names (PostgreSQL built-in)
CREATE INDEX idx_player_name_fts ON "Player" USING gin(to_tsvector('english', "name"));
CREATE INDEX idx_team_name_fts   ON "Team"   USING gin(to_tsvector('english', "name"));
```

---

## 5. Migrations Strategy

```bash
# Create a migration
npx prisma migrate dev --name add_xg_to_stats

# Apply in production (CI/CD pipeline)
npx prisma migrate deploy

# Generate Prisma client after schema change
npx prisma generate
```

### Migration discipline
- **Never** edit an existing migration file — create a new one
- **Always** run `prisma migrate dev` locally before pushing
- **Additive-only** in production: add columns with defaults, never drop or rename (use deprecation cycle)
- Zero-downtime pattern for renaming a column:
  1. Migration 1: add new column with default
  2. Deploy: write to both old + new column
  3. Migration 2: backfill old → new
  4. Deploy: read from new column only
  5. Migration 3: drop old column

---

## 6. Multi-Region Setup

Aurora Global Database spans regions. Write to the primary region, read from replicas.

```typescript
// Two Prisma clients — writer goes to primary, reader to replica
const writerDB = new PrismaClient({
  datasources: { db: { url: process.env.DB_WRITER_URL } }
});

const readerDB = new PrismaClient({
  datasources: { db: { url: process.env.DB_READER_URL } }
});

// Use reader for all GETs, writer for mutations
export const db = {
  read: readerDB,
  write: writerDB,
};
```

**Replication lag:** Aurora replicas have ~20ms lag. For live match data (scores, events), always read from writer to avoid serving stale scores. For slower-changing data (standings, profiles), replica reads are fine.

---

## 7. Connection Pooling

Aurora has connection limits per instance. At scale, use **PgBouncer** or **RDS Proxy** in front of Aurora.

```typescript
// Prisma connection pool config
const prisma = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_URL }
  },
  // connection_limit in the URL string:
  // postgresql://user:pass@host:5432/db?connection_limit=10&pool_timeout=20
});

// Singleton pattern — one Prisma client per service instance
let prismaInstance: PrismaClient;
export function getPrisma(): PrismaClient {
  if (!prismaInstance) prismaInstance = new PrismaClient();
  return prismaInstance;
}
```

| Service | connection_limit | Rationale |
|---------|-----------------|-----------|
| Scores service | 10 | High read traffic, short queries |
| Stats service | 5 | Batch jobs, longer queries |
| User service | 5 | Low traffic, auth only |
| News service | 3 | Infrequent writes |

Total connections across all pods must stay under Aurora's `max_connections` (default 5000 for `db.r6g.2xlarge`). Set `max_connections` = (CPUs × 100) as a safe ceiling, then divide across services.

---
name: fotmob-clone
description: >
  Architecture, stack decisions, module breakdown, and implementation guidance for building
  a FotMob-style live football/sports app. Use this skill whenever the user wants to build,
  scaffold, design, or discuss any part of a live sports app — including live scores, push
  notifications, match stats, player profiles, news feeds, league tables, user auth, or
  personalisation. Also trigger for questions about Angular sports web apps, Flutter sports
  mobile apps, real-time data pipelines, sports data provider integration, or scaling a
  sports platform. Use even if the user doesn't say "FotMob" — trigger on phrases like
  "sports app", "live scores app", "football tracker", "match updates app", or any request
  to build something that tracks live sports events.
---

# FotMob-Clone Architecture Skill

A complete reference for building a FotMob-style live sports platform.

**Stack choices for this project:**
- **Web**: Angular (TypeScript)
- **Mobile**: Flutter (Dart)
- **Backend**: Node.js microservices on AWS (EKS / Lambda)
- **Database**: Amazon Aurora (PostgreSQL-compatible) + Redis (ElastiCache)
- **Storage**: Amazon S3
- **CDN**: Amazon CloudFront
- **AI layer**: Amazon Bedrock (Claude)
- **Push notifications**: In-house on AWS (EKS + APNs/FCM)
- **Data providers**: Stats Perform / Opta / SportRadar (or free-tier ESPN API for MVP)

---

## Table of Contents

1. [System Architecture Overview](#1-system-architecture-overview)
2. [Module Map](#2-module-map)
3. [Web — Angular](#3-web--angular) → `references/angular.md`
4. [Mobile — Flutter](#4-mobile--flutter) → `references/flutter.md`
5. [Backend Microservices](#5-backend-microservices) → `references/backend.md`
6. [Database — Aurora + Redis](#6-database--aurora--redis) → `references/database.md`
7. [DevOps — AWS CDK, EKS, CI/CD](#7-devops--aws-cdk-eks-cicd) → `references/devops.md`
8. [Data Providers & Ingestion](#8-data-providers--ingestion) → `references/data-providers.md`
9. [Push Notification Engine](#9-push-notification-engine) → `references/notifications.md`
10. [Auth & Security](#10-auth--security) → `references/auth-security.md`
11. [AI / ML Layer](#11-ai--ml-layer) → `references/ai-ml.md`
12. [Testing Strategy](#12-testing-strategy) → `references/testing.md`
13. [Infrastructure & Scaling](#13-infrastructure--scaling)
14. [MVP Scoping Guide](#14-mvp-scoping-guide)

---

## 1. System Architecture Overview

```
┌─────────────────────────────────────────────┐
│              CLIENT LAYER                   │
│   Angular (Web)        Flutter (Mobile)     │
└────────────┬────────────────────┬───────────┘
             │                    │
             ▼                    ▼
┌─────────────────────────────────────────────┐
│         EDGE / CDN (CloudFront)             │
│   Static assets · Cached API responses      │
└────────────────────┬────────────────────────┘
                     ▼
┌─────────────────────────────────────────────┐
│     API GATEWAY (AWS Lambda + REST/JSON)    │
│   Auth · Rate limiting · Routing            │
└──┬────────┬────────┬────────┬────────┬──────┘
   ▼        ▼        ▼        ▼        ▼
Scores  Notif.   Stats    News    User/Auth
Service Service  Service  Service  Service
   └────────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
   EC2 Compute   ElastiCache   EKS Workers
   (real-time)   (Redis cache) (push notifs)
        └────────────┼────────────┘
                     ▼
        ┌────────────┼────────────┐
        ▼            ▼            ▼
   Aurora DB       S3         CDK (IaC)
   (multi-region) (media)   (infra-as-code)
                     │
                     ▼
           AI Layer (Bedrock/Claude)
           ML: ratings, momentum, summaries
                     │
                     ▼
          External Data Providers
          Stats Perform · Opta · Feeds
```

**Key scale targets** (FotMob production numbers to design toward):
- 17M+ active users
- 500+ leagues worldwide
- 5B HTTP requests/hour at peak (1.6M req/sec)
- 3B+ push notifications/week
- Sub-1-second match event propagation

---

## 2. Module Map

Every feature in FotMob maps to one of these modules. Build them in priority order for MVP.

| # | Module | Priority | Backend service | Real-time? |
|---|--------|----------|----------------|------------|
| 1 | Live Scores & Match Centre | P0 | Scores service | Yes (WebSocket) |
| 2 | League Tables & Fixtures | P0 | Scores service | No (poll) |
| 3 | User Auth & Favourites | P0 | User service | No |
| 4 | Push Notifications | P1 | Notif. service | Yes |
| 5 | Match Stats & Visualisations | P1 | Stats service | Partial |
| 6 | Player & Team Profiles | P1 | Stats service | No |
| 7 | News Feed | P2 | News service | No (poll) |
| 8 | Search & Discovery | P2 | Search service | No |
| 9 | AI Match Summaries | P3 | AI service | No |
| 10 | Audio Commentary | P3 | Media service | Streaming |

---

## 3. Web — Angular

> **Read `references/angular.md`** for full Angular project structure, module breakdown,
> state management pattern, WebSocket integration, routing, and component architecture.

**Quick summary:**
- NgRx for global state (scores, user, notifications)
- Angular Signals for local/reactive UI state
- WebSocket service wrapping RxJS for live events
- Lazy-loaded feature modules per section (scores, stats, news, profile)
- Angular CDK Virtual Scroll for long league/fixture lists
- SSR via Angular Universal for SEO on public pages

---

## 4. Mobile — Flutter

> **Read `references/flutter.md`** for full Flutter project structure, package choices,
> BLoC state management, platform-specific push notification handling, and offline support.

**Quick summary:**
- flutter_bloc (BLoC pattern) for state management
- Riverpod as alternative for simpler feature modules
- web_socket_channel for live score streams
- firebase_messaging for push notifications
- go_router for navigation
- Hive or Isar for local offline caching
- fl_chart for stats visualisations (xG, momentum)

---

## 5. Backend Microservices

> **Read `references/backend.md`** for full Node.js service implementations, WebSocket hub, API gateway patterns, and service communication.

**Quick summary:**

All services are Node.js (TypeScript), containerised, deployed on AWS EKS.

### Scores Service
- Ingests raw match events from data provider webhooks
- Publishes events to Redis pub/sub channel
- Stores canonical match state in Aurora
- Exposes REST endpoints: `GET /matches`, `GET /matches/:id`, `GET /leagues/:id/table`
- Exposes WebSocket endpoint: `WS /live/:matchId`

### Stats Service
- Computes derived stats (xG, player ratings, heatmaps) from raw event data
- Runs as batch jobs on EC2 post-match, near-real-time during match
- Stores results in S3 (large payloads) and Aurora (queryable stats)
- Endpoints: `GET /matches/:id/stats`, `GET /players/:id`, `GET /teams/:id`

### User Service
- JWT auth (access + refresh tokens)
- Stores user preferences, favourite teams/leagues/players in Aurora
- Manages notification subscription topics per user
- Endpoints: `POST /auth/login`, `GET /users/me`, `PUT /users/me/favourites`

### Notifications Service
- Subscribes to Redis pub/sub for match events
- Filters by user subscriptions (who follows this team?)
- Fans out to APNs (iOS) and FCM (Android) via EKS workers
- At scale: batch fan-out using SQS queues between event receipt and delivery

### News Service
- Ingests RSS/Atom feeds from clubs, leagues, and wire services
- Stores articles in Aurora, media in S3
- AI summary generation via Bedrock Claude (async, post-ingest)
- Endpoints: `GET /news`, `GET /news/:id`, `GET /news?team=:id`

---

## 6. Data Pipeline & Real-Time Layer

### Data ingestion
```
Data Provider Webhook
        │
        ▼
   Lambda receiver
   (validates, normalises)
        │
        ▼
   Aurora (canonical store)
        │
        ▼
   Redis pub/sub (hot events)
        │
     ┌──┴──┐
     ▼     ▼
  WS hub  Notif.
 (clients) service
```

**Normalisation is critical.** Every provider has a different schema for a "goal" event.
Define a canonical `MatchEvent` type once and normalise at ingestion time:

```typescript
interface MatchEvent {
  id: string;
  matchId: string;
  type: 'goal' | 'yellow_card' | 'red_card' | 'substitution' | 'penalty' | 'var';
  minute: number;
  teamId: string;
  playerId?: string;
  assistPlayerId?: string;
  score?: { home: number; away: number };
  timestamp: Date;
}
```

### WebSocket hub
- Stateless WS servers behind a load balancer
- Each client subscribes to match rooms: `JOIN match:${matchId}`
- EC2 + ElastiCache (Redis) for fan-out across WS server instances
- Heartbeat every 30s; reconnect with exponential backoff on client

### Caching strategy
| Data | TTL | Storage |
|------|-----|---------|
| Live match state | 5s | Redis |
| League table | 60s | Redis |
| Player profile | 1h | Redis |
| Historical stats | 24h | Redis → S3 fallback |
| Static assets | 7d | CloudFront |

---

## 7. Push Notification Engine

FotMob's biggest engineering challenge. Do NOT use a third-party provider at scale —
they crash under peak load (major match kick-off, World Cup final).

### Architecture
```
Redis pub/sub (match event)
        │
        ▼
Fan-out Lambda
(query Aurora: who follows this team?)
        │
        ▼
SQS queue (batched user lists)
        │
        ▼
EKS Worker pool
(send to APNs/FCM in parallel)
```

### Notification types
- **Goal alert** — immediate, highest priority
- **Match start/end** — immediate
- **Line-up released** — 1h before kick-off
- **News alert** — low priority, batched

### Payload structure
```json
{
  "title": "GOAL — Arsenal 1-0 Chelsea",
  "body": "Saka 23' — First goal of the match",
  "data": {
    "type": "goal",
    "matchId": "abc123",
    "deepLink": "/match/abc123"
  },
  "priority": "high",
  "collapseKey": "match:abc123"
}
```

---

## 8. AI / ML Layer

### Bedrock / Claude integration
- **Team summaries**: Post-match narrative generation. Prompt includes raw stats JSON → returns readable 3-paragraph summary.
- **Match reports**: Generated async after final whistle, stored in S3, surfaced via News service.
- **Multi-language**: Same prompt, language parameter. Claude handles translation natively.

### ML models (internal)
- **Player ratings**: 0–10 score computed from weighted event contributions (goals, assists, key passes, defensive actions). Batch job, post-match.
- **Momentum graph**: Rolling xG delta over time. Computed from shot event stream during match.
- **xG model**: Expected goals per shot, trained on historical shot data. Served as a Lambda function.

---

## 9. Infrastructure & Scaling

### AWS services in use
| Service | Purpose |
|---------|---------|
| EKS | Microservice orchestration |
| EC2 | Real-time compute, WS hubs |
| Lambda | API gateway handlers, event receivers |
| Aurora | Primary relational DB (multi-region) |
| ElastiCache (Redis) | Caching + pub/sub |
| S3 | Media, stats payloads, AI output |
| CloudFront | CDN, edge caching |
| SQS | Notification fan-out queue |
| Bedrock | LLM inference (Claude) |
| CDK | Infrastructure as code |

### Horizontal scaling rules
- WS hub: scale on connection count (target <10k connections/instance)
- Scores service: scale on CPU (target 60%)
- Notif. workers: scale on SQS queue depth (target <1000 messages/worker)
- DB: Aurora auto-scaling read replicas, write to primary only

---

## 10. MVP Scoping Guide

Ship a working v1 in 3 months with this cut:

**In scope (MVP)**
- Live scores for 5 major leagues (PL, La Liga, Bundesliga, Serie A, Ligue 1)
- League tables + fixtures
- Basic match stats (possession, shots, cards)
- User account + favourite teams
- Push notifications for goals only
- Angular web + Flutter mobile

**Out of scope (post-MVP)**
- Player/team profiles
- Historical stats
- AI summaries
- Audio commentary
- 500-league coverage
- xG / advanced ML

**Data provider for MVP**: SportRadar free trial or ESPN API (free, limited to top leagues).
Switch to Stats Perform or Opta when scaling beyond 10 leagues.

**Estimated team for MVP**: 2 backend engineers + 1 Angular + 1 Flutter + 1 DevOps.
Timeline: 12–16 weeks to public beta.

---

## 6. Database — Aurora + Redis

> **Read `references/database.md`** for the full Prisma schema, all key query patterns, Redis caching strategy with key naming conventions, index design, migration workflow, multi-region Aurora setup, and connection pooling config.

## 7. DevOps — AWS CDK, EKS, CI/CD

> **Read `references/devops.md`** for the full CDK stack (VPC, Aurora, Redis, EKS, SQS, S3), Kubernetes deployment manifests, GitHub Actions CI/CD pipeline, Dockerfiles, secrets management with AWS Secrets Manager, CloudWatch alerting, and autoscaling rules.

## 8. Data Providers & Ingestion

> **Read `references/data-providers.md`** for provider comparison (Stats Perform vs SportRadar vs ESPN), the canonical data model, normalisation adaptors for each provider, ingestion Lambda, idempotency patterns, and scheduled sync jobs.

## 9. Push Notification Engine

> **Read `references/notifications.md`** for the full fan-out pipeline, APNs HTTP/2 integration, FCM multicast, notification payload types, user subscription management, scaling to billions of messages, and delivery tracking.

## 10. Auth & Security

> **Read `references/auth-security.md`** for JWT access/refresh token rotation, OAuth (Google + Apple Sign In), Fastify auth plugin, Redis-backed distributed rate limiting, HMAC webhook verification, password hashing, CORS config, and the full security checklist.

## 11. AI / ML Layer

> **Read `references/ai-ml.md`** for Amazon Bedrock setup, match summary generation prompts, team summary feature, multi-language support, the xG logistic regression model, player rating weights, momentum graph computation, async AI job queue, and cost management patterns.

## 12. Testing Strategy

> **Read `references/testing.md`** for Vitest backend unit + integration tests, testcontainers DB testing, Angular Jest + Testing Library component tests, Playwright E2E tests, Flutter BLoC tests, widget tests, integration tests, CI pipeline YAML, and test data factories.

# Testing Strategy Reference

Unit, integration, and end-to-end testing across Node.js backend, Angular web, and Flutter mobile.

---

## Table of Contents
1. [Testing Philosophy](#1-testing-philosophy)
2. [Backend — Node.js / Fastify](#2-backend--nodejs--fastify)
3. [Database Testing](#3-database-testing)
4. [Angular — Unit & Component Tests](#4-angular--unit--component-tests)
5. [Angular — E2E Tests (Playwright)](#5-angular--e2e-tests-playwright)
6. [Flutter — Unit & Widget Tests](#6-flutter--unit--widget-tests)
7. [Flutter — Integration Tests](#7-flutter--integration-tests)
8. [CI Test Pipeline](#8-ci-test-pipeline)
9. [Test Data Factories](#9-test-data-factories)

---

## 1. Testing Philosophy

| Layer | Tool | Target coverage | What to test |
|-------|------|-----------------|--------------|
| Backend unit | Vitest | 80%+ on services | Business logic, normalisation, ratings |
| Backend integration | Vitest + testcontainers | Key API endpoints | DB queries, Redis caching, auth flows |
| Angular unit | Jest + Testing Library | 70%+ | Components, pipes, BLoC/NgRx reducers |
| Angular E2E | Playwright | Critical user flows | Scores page, match detail, login |
| Flutter unit | flutter_test | 80%+ | BLoC, repository, use cases |
| Flutter widget | flutter_test | Key widgets | MatchCard, ScoreBadge, LivePulse |
| Flutter integration | integration_test | Core flows | Navigate to match, live score update |

**The testing pyramid:**
- Lots of fast unit tests (seconds)
- Moderate integration tests (minutes)
- Few E2E tests (only critical paths — they're slow and flaky)

---

## 2. Backend — Node.js / Fastify

Use **Vitest** (faster than Jest, native ESM).

```bash
npm install -D vitest @vitest/coverage-v8 supertest
```

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: { provider: 'v8', reporter: ['text', 'lcov'], threshold: { lines: 80 } },
    setupFiles: ['./src/test/setup.ts'],
  },
});
```

### Unit test — normalisation function
```typescript
// src/normalisation/__tests__/sportradar.test.ts
import { describe, it, expect } from 'vitest';
import { normaliseSportRadar } from '../sportradar';

describe('normaliseSportRadar', () => {
  it('normalises a goal event', () => {
    const raw = {
      metadata: { operation: 'update', change_type: 'scorechange' },
      payload: {
        game: { id: 'sr:match:123' },
        event: {
          id: 'sr:event:456',
          type: 'scorechange',
          clock: { played: '45:00' },
          competitor: 'home',
          players: [
            { id: 'sr:player:789', type: 'scorer' },
            { id: 'sr:player:101', type: 'assist' },
          ],
          home_score: 1,
          away_score: 0,
        },
      },
    };

    const result = normaliseSportRadar(raw);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('GOAL');
    expect(result!.minute).toBe(45);
    expect(result!.scoreAfter).toEqual({ home: 1, away: 0 });
  });

  it('returns null for ignored event types', () => {
    const raw = { payload: { event: { type: 'pass' } } } as any;
    expect(normaliseSportRadar(raw)).toBeNull();
  });
});
```

### Unit test — player rating
```typescript
// src/ml/__tests__/player-rating.test.ts
import { computePlayerRating } from '../player-rating';

describe('computePlayerRating', () => {
  const mockPlayer = { id: '1', position: 'FWD' } as any;

  it('gives a goal scorer a rating above 7', () => {
    const actions = [
      { type: 'GOAL' },
      { type: 'SHOT_ON_TARGET' },
      { type: 'KEY_PASS' },
    ];
    const rating = computePlayerRating(mockPlayer, actions as any, 90);
    expect(rating).toBeGreaterThan(7);
  });

  it('penalises a player who got a red card', () => {
    const baselineActions: any[] = [];
    const baseRating = computePlayerRating(mockPlayer, baselineActions, 90);

    const penalisedActions = [{ type: 'RED_CARD' }];
    const penalisedRating = computePlayerRating(mockPlayer, penalisedActions as any, 90);

    expect(penalisedRating).toBeLessThan(baseRating);
  });

  it('caps rating at 10', () => {
    const superActions = Array(20).fill({ type: 'GOAL' });
    const rating = computePlayerRating(mockPlayer, superActions as any, 90);
    expect(rating).toBeLessThanOrEqual(10);
  });
});
```

### Integration test — Fastify route
```typescript
// src/routes/__tests__/matches.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer } from '../../index';
import { prisma } from '../../db';
import { matchFactory } from '../../test/factories';

describe('GET /matches', () => {
  let server: any;

  beforeAll(async () => {
    server = buildServer();
    await server.ready();
    // Seed test data
    await prisma.match.createMany({ data: [matchFactory({ kickoffTime: '2024-01-15T15:00:00Z' })] });
  });

  afterAll(async () => {
    await server.close();
    await prisma.match.deleteMany({});  // cleanup
  });

  it('returns matches for a given date', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/matches?date=2024-01-15',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].matches.length).toBeGreaterThan(0);
  });

  it('returns 400 for invalid date format', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/matches?date=not-a-date',
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns cached response on second request', async () => {
    await server.inject({ method: 'GET', url: '/matches?date=2024-01-15' });
    const response = await server.inject({ method: 'GET', url: '/matches?date=2024-01-15' });
    expect(response.headers['x-cache']).toBe('HIT');
  });
});
```

---

## 3. Database Testing

Use **testcontainers** to spin up a real PostgreSQL instance for integration tests.

```bash
npm install -D testcontainers @testcontainers/postgresql
```

```typescript
// src/test/setup.ts
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'child_process';

let container: any;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const url = container.getConnectionUri();
  process.env.DATABASE_URL = url;

  // Run migrations against test DB
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url } });
}, 60_000);

afterAll(async () => {
  await container?.stop();
});
```

---

## 4. Angular — Unit & Component Tests

Use **Jest** + **@testing-library/angular** for component tests.

```bash
npm install -D jest @testing-library/angular @testing-library/user-event jest-environment-jsdom
```

### NgRx reducer test
```typescript
// features/scores/store/scores.reducer.spec.ts
import { scoresReducer, initialState } from './scores.reducer';
import { loadMatchesSuccess, updateLiveMatch } from './scores.actions';

describe('ScoresReducer', () => {
  it('should populate matches on loadMatchesSuccess', () => {
    const matches = [{ id: '1', homeTeam: 'Arsenal', status: 'SCHEDULED' }] as any;
    const action = loadMatchesSuccess({ matches });
    const state = scoresReducer(initialState, action);

    expect(state.matches.ids).toContain('1');
    expect(state.loading).toBe(false);
  });

  it('should update a match score on live event', () => {
    // Setup state with a match
    const seedState = scoresReducer(initialState, loadMatchesSuccess({
      matches: [{ id: '1', homeScore: 0, awayScore: 0, status: 'LIVE' } as any]
    }));

    const event = { matchId: '1', type: 'GOAL', score: { home: 1, away: 0 } } as any;
    const state = scoresReducer(seedState, updateLiveMatch({ event }));

    expect(state.matches.entities['1']?.homeScore).toBe(1);
  });
});
```

### Component test with Testing Library
```typescript
// features/scores/widgets/match-row.component.spec.ts
import { render, screen } from '@testing-library/angular';
import { MatchRowComponent } from './match-row.component';
import { matchFactory } from '../../../test/factories';

describe('MatchRowComponent', () => {
  it('displays team names and score', async () => {
    const match = matchFactory({
      homeTeam: { name: 'Arsenal' },
      awayTeam: { name: 'Chelsea' },
      homeScore: 2,
      awayScore: 1,
      status: 'FINISHED',
    });

    await render(MatchRowComponent, { componentInputs: { match } });

    expect(screen.getByText('Arsenal')).toBeInTheDocument();
    expect(screen.getByText('Chelsea')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('shows live pulse indicator for live matches', async () => {
    const match = matchFactory({ status: 'LIVE', minute: 67 });
    await render(MatchRowComponent, { componentInputs: { match } });

    expect(screen.getByTestId('live-pulse')).toBeInTheDocument();
    expect(screen.getByText("67'")).toBeInTheDocument();
  });
});
```

### Pipe test
```typescript
// shared/pipes/match-time.pipe.spec.ts
import { MatchTimePipe } from './match-time.pipe';

describe('MatchTimePipe', () => {
  const pipe = new MatchTimePipe();

  it('returns match time for scheduled matches', () => {
    const match = { status: 'SCHEDULED', kickoffTime: '2024-01-15T20:00:00Z' } as any;
    expect(pipe.transform(match)).toBe('20:00');
  });

  it('returns FT for finished matches', () => {
    const match = { status: 'FINISHED' } as any;
    expect(pipe.transform(match)).toBe('FT');
  });

  it('returns HT for halftime', () => {
    const match = { status: 'HALFTIME' } as any;
    expect(pipe.transform(match)).toBe('HT');
  });
});
```

---

## 5. Angular — E2E Tests (Playwright)

```bash
npm install -D @playwright/test
npx playwright install
```

```typescript
// e2e/scores.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Scores page', () => {
  test('loads today\'s matches', async ({ page }) => {
    await page.goto('/scores');

    // Wait for matches to load
    await expect(page.locator('[data-testid="match-row"]').first()).toBeVisible();

    // At least one league group is visible
    const leagueGroups = page.locator('[data-testid="league-group"]');
    expect(await leagueGroups.count()).toBeGreaterThan(0);
  });

  test('navigates to match detail on click', async ({ page }) => {
    await page.goto('/scores');
    await page.locator('[data-testid="match-row"]').first().click();

    await expect(page).toHaveURL(/\/match\/.+/);
    await expect(page.locator('[data-testid="match-header"]')).toBeVisible();
  });

  test('changes date when date picker is used', async ({ page }) => {
    await page.goto('/scores');
    const tomorrow = page.locator('[data-testid="date-next"]');
    await tomorrow.click();

    await expect(page.locator('[data-testid="date-picker-selected"]'))
      .not.toHaveText('Today');
  });
});

test.describe('Authentication', () => {
  test('redirects unauthenticated user from /profile to /scores', async ({ page }) => {
    await page.goto('/profile');
    await expect(page).toHaveURL('/scores');
  });

  test('allows login with valid credentials', async ({ page }) => {
    await page.goto('/profile');
    await page.fill('[data-testid="email-input"]', 'test@example.com');
    await page.fill('[data-testid="password-input"]', 'TestPassword1');
    await page.click('[data-testid="login-button"]');

    await expect(page.locator('[data-testid="user-profile"]')).toBeVisible();
  });
});
```

---

## 6. Flutter — Unit & Widget Tests

```dart
// test/features/scores/bloc/scores_bloc_test.dart
import 'package:bloc_test/bloc_test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

class MockGetMatchesByDate extends Mock implements GetMatchesByDate {}

void main() {
  late MockGetMatchesByDate mockUseCase;
  late ScoresBloc bloc;

  setUp(() {
    mockUseCase = MockGetMatchesByDate();
    bloc = ScoresBloc(getMatchesByDate: mockUseCase, wsClient: MockWebSocketClient());
  });

  tearDown(() => bloc.close());

  group('LoadMatchesByDate', () {
    final tDate = DateTime(2024, 1, 15);
    final tGroups = [LeagueGroup(leagueName: 'Premier League', matches: [fakeMatch()])];

    blocTest<ScoresBloc, ScoresState>(
      'emits [Loading, Loaded] when use case succeeds',
      build: () {
        when(() => mockUseCase(tDate)).thenAnswer((_) async => Right(tGroups));
        return bloc;
      },
      act: (b) => b.add(LoadMatchesByDate(tDate)),
      expect: () => [ScoresLoading(), ScoresLoaded(groups: tGroups, selectedDate: tDate)],
    );

    blocTest<ScoresBloc, ScoresState>(
      'emits [Loading, Error] when use case fails',
      build: () {
        when(() => mockUseCase(tDate)).thenAnswer((_) async => Left(NetworkFailure('No connection')));
        return bloc;
      },
      act: (b) => b.add(LoadMatchesByDate(tDate)),
      expect: () => [ScoresLoading(), const ScoresError('No connection')],
    );
  });
}
```

### Widget test
```dart
// test/shared/widgets/match_card_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';

void main() {
  group('MatchCard', () {
    testWidgets('displays both team names', (tester) async {
      final match = fakeMatch(
        homeTeam: fakeTeam(name: 'Arsenal'),
        awayTeam: fakeTeam(name: 'Chelsea'),
      );

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: MatchCard(match: match)),
        ),
      );

      expect(find.text('Arsenal'), findsOneWidget);
      expect(find.text('Chelsea'), findsOneWidget);
    });

    testWidgets('shows live pulse for live matches', (tester) async {
      final match = fakeMatch(status: MatchStatus.live, minute: 67);

      await tester.pumpWidget(
        MaterialApp(home: Scaffold(body: MatchCard(match: match))),
      );
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.byType(FadeTransition), findsOneWidget);
      expect(find.text("67'"), findsOneWidget);
    });

    testWidgets('navigates to match detail on tap', (tester) async {
      final match = fakeMatch(id: 'abc-123');
      final routes = <String>[];

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: MatchCard(match: match)),
          onGenerateRoute: (settings) {
            routes.add(settings.name ?? '');
            return MaterialPageRoute(builder: (_) => const SizedBox());
          },
        ),
      );

      await tester.tap(find.byType(MatchCard));
      await tester.pumpAndSettle();

      expect(routes, contains('/match/abc-123'));
    });
  });
}
```

---

## 7. Flutter — Integration Tests

```dart
// integration_test/scores_flow_test.dart
import 'package:integration_test/integration_test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fotmob_mobile/main.dart' as app;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  group('Scores flow', () {
    testWidgets('shows matches and navigates to detail', (tester) async {
      app.main();
      await tester.pumpAndSettle(const Duration(seconds: 3));

      // Should land on scores page
      expect(find.byKey(const Key('scores-page')), findsOneWidget);

      // Match cards should be visible
      await tester.pumpAndSettle();
      expect(find.byType(MatchCard), findsWidgets);

      // Tap first match
      await tester.tap(find.byType(MatchCard).first);
      await tester.pumpAndSettle();

      // Should navigate to match detail
      expect(find.byKey(const Key('match-detail-page')), findsOneWidget);
    });
  });
}
```

```bash
# Run integration tests on emulator
flutter test integration_test/scores_flow_test.dart
```

---

## 8. CI Test Pipeline

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  backend-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: fotmob_test
          POSTGRES_PASSWORD: test
        ports: ['5432:5432']
      redis:
        image: redis:7-alpine
        ports: ['6379:6379']

    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - run: pnpm install
      - run: pnpm test --coverage
        env:
          DATABASE_URL: postgresql://postgres:test@localhost:5432/fotmob_test
          REDIS_URL: redis://localhost:6379

  angular-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
        working-directory: apps/web
      - run: npm test -- --watch=false --code-coverage
        working-directory: apps/web

  angular-e2e:
    runs-on: ubuntu-latest
    needs: angular-tests
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npx playwright install --with-deps
        working-directory: apps/web
      - run: npm run e2e
        working-directory: apps/web

  flutter-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: subosito/flutter-action@v2
        with: { flutter-version: '3.19.x' }
      - run: flutter pub get
        working-directory: apps/mobile
      - run: flutter test --coverage
        working-directory: apps/mobile
      - uses: codecov/codecov-action@v4
        with:
          files: apps/mobile/coverage/lcov.info
```

---

## 9. Test Data Factories

Centralise fake data creation to keep tests DRY.

```typescript
// services/scores/src/test/factories.ts
import { Match, Team, Player, MatchEvent } from '@fotmob/shared';

export function teamFactory(overrides: Partial<Team> = {}): Team {
  return {
    id: crypto.randomUUID(),
    externalId: `ext-${Math.random()}`,
    name: 'Test FC',
    shortName: 'TFC',
    logoUrl: 'https://example.com/logo.png',
    countryCode: 'GB',
    ...overrides,
  };
}

export function matchFactory(overrides: Partial<Match> = {}): Match {
  return {
    id: crypto.randomUUID(),
    externalId: `ext-${Math.random()}`,
    leagueId: crypto.randomUUID(),
    leagueName: 'Premier League',
    homeTeam: teamFactory({ name: 'Home FC' }),
    awayTeam: teamFactory({ name: 'Away FC' }),
    homeScore: 0,
    awayScore: 0,
    status: 'SCHEDULED',
    minute: null,
    kickoffTime: new Date().toISOString(),
    venue: 'Test Stadium',
    round: 'Matchday 1',
    ...overrides,
  };
}

export function goalEventFactory(matchId: string, overrides: Partial<MatchEvent> = {}): MatchEvent {
  return {
    id: crypto.randomUUID(),
    matchId,
    type: 'GOAL',
    minute: 45,
    teamId: crypto.randomUUID(),
    playerId: crypto.randomUUID(),
    playerName: 'Test Player',
    ...overrides,
  };
}
```

```dart
// Flutter factories
// test/helpers/factories.dart
Match fakeMatch({
  String? id,
  MatchStatus status = MatchStatus.scheduled,
  int? minute,
  Team? homeTeam,
  Team? awayTeam,
}) => Match(
  id: id ?? 'match-${Random().nextInt(9999)}',
  homeTeam: homeTeam ?? fakeTeam(name: 'Arsenal'),
  awayTeam: awayTeam ?? fakeTeam(name: 'Chelsea'),
  homeScore: 0,
  awayScore: 0,
  status: status,
  minute: minute,
  kickoffTime: DateTime.now(),
  leagueName: 'Premier League',
);

Team fakeTeam({String? name}) => Team(
  id: 'team-${Random().nextInt(9999)}',
  name: name ?? 'Test FC',
  shortName: name?.substring(0, 3).toUpperCase() ?? 'TFC',
  logoUrl: 'https://example.com/logo.png',
);
```

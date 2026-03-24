# Angular Web Reference

Full implementation guide for the FotMob-clone web app using Angular.

---

## Table of Contents
1. [Project Setup](#1-project-setup)
2. [Project Structure](#2-project-structure)
3. [State Management — NgRx](#3-state-management--ngrx)
4. [Feature Modules](#4-feature-modules)
5. [Real-Time WebSocket Layer](#5-real-time-websocket-layer)
6. [Routing Architecture](#6-routing-architecture)
7. [Key Components](#7-key-components)
8. [API Service Layer](#8-api-service-layer)
9. [Performance Patterns](#9-performance-patterns)
10. [Angular Universal (SSR)](#10-angular-universal-ssr)

---

## 1. Project Setup

```bash
npm install -g @angular/cli
ng new fotmob-web --routing --style=scss --strict
cd fotmob-web

# Core dependencies
npm install @ngrx/store @ngrx/effects @ngrx/entity @ngrx/router-store
npm install @ngrx/store-devtools          # dev only
npm install rxjs
npm install @angular/cdk                  # virtual scroll, overlay
npm install dayjs                         # lightweight date formatting
npm install rxjs-websocket               # WebSocket wrapper

# Optional but recommended
npm install @angular/pwa                  # PWA support
ng add @angular/universal                 # SSR
```

---

## 2. Project Structure

```
src/
├── app/
│   ├── core/                      # Singleton services, guards, interceptors
│   │   ├── services/
│   │   │   ├── auth.service.ts
│   │   │   ├── websocket.service.ts
│   │   │   └── api.service.ts
│   │   ├── guards/
│   │   │   └── auth.guard.ts
│   │   ├── interceptors/
│   │   │   ├── auth.interceptor.ts    # Attach JWT to requests
│   │   │   └── error.interceptor.ts
│   │   └── core.module.ts
│   │
│   ├── shared/                    # Reusable dumb components, pipes, directives
│   │   ├── components/
│   │   │   ├── match-card/
│   │   │   ├── score-badge/
│   │   │   ├── player-avatar/
│   │   │   └── league-logo/
│   │   ├── pipes/
│   │   │   ├── match-time.pipe.ts
│   │   │   └── player-rating.pipe.ts
│   │   └── shared.module.ts
│   │
│   ├── features/                  # Lazy-loaded feature modules
│   │   ├── scores/                # Home / live scores tab
│   │   ├── leagues/               # League tables + fixtures
│   │   ├── match-detail/          # Match centre (live + historic)
│   │   ├── player/                # Player profile
│   │   ├── team/                  # Team profile
│   │   ├── news/                  # News feed
│   │   └── profile/               # User account + settings
│   │
│   ├── store/                     # NgRx root state
│   │   ├── app.state.ts
│   │   └── app.reducer.ts
│   │
│   ├── app-routing.module.ts
│   ├── app.component.ts
│   └── app.module.ts
│
├── environments/
│   ├── environment.ts             # dev: ws://localhost, api: localhost
│   └── environment.prod.ts        # prod: CloudFront URLs
└── assets/
    └── league-logos/
```

---

## 3. State Management — NgRx

Use NgRx for all server-derived state. Use Angular Signals for local/ephemeral UI state.

### Root state shape

```typescript
// store/app.state.ts
export interface AppState {
  scores: ScoresState;
  user: UserState;
  notifications: NotificationsState;
}
```

### Scores feature state (example)

```typescript
// features/scores/store/scores.state.ts
export interface ScoresState {
  matches: EntityState<Match>;    // NgRx Entity for normalised match map
  selectedDate: string;           // ISO date string 'YYYY-MM-DD'
  liveMatchIds: string[];         // IDs of currently live matches
  loading: boolean;
  error: string | null;
}

// Actions
export const loadMatches = createAction('[Scores] Load Matches', props<{ date: string }>());
export const loadMatchesSuccess = createAction('[Scores] Load Success', props<{ matches: Match[] }>());
export const updateLiveMatch = createAction('[Scores] Live Update', props<{ event: MatchEvent }>());

// Effects — loadMatches triggers HTTP, WebSocket events dispatch updateLiveMatch
```

### When to use Signals vs NgRx

| Use Signals | Use NgRx |
|-------------|----------|
| Tab selection, accordion open/close | Live match data |
| Form state | User auth + session |
| Loading spinners local to a component | Favourite teams list |
| Scroll position | Notification preferences |

---

## 4. Feature Modules

Each feature is lazy-loaded via the router. Create with:

```bash
ng generate module features/scores --routing
ng generate module features/match-detail --routing
ng generate module features/leagues --routing
ng generate module features/news --routing
ng generate module features/profile --routing
```

### Scores Module

Main home screen. Shows today's matches grouped by league.

**Key components:**
- `ScoresPageComponent` — smart container, selects from store
- `DatePickerComponent` — horizontal date scroller (–3 days to +3 days)
- `LeagueGroupComponent` — collapsible league section
- `MatchRowComponent` — single match tile (dumb, `@Input() match: Match`)

**Virtual scroll** for long match lists:
```html
<!-- Use CDK Virtual Scroll when > 50 matches -->
<cdk-virtual-scroll-viewport itemSize="64" class="match-list">
  <app-match-row *cdkVirtualFor="let match of matches$ | async"
                 [match]="match"
                 (click)="openMatch(match.id)">
  </app-match-row>
</cdk-virtual-scroll-viewport>
```

### Match Detail Module

The full match centre. Tabs: Summary | Stats | Lineups | Timeline.

**Components:**
- `MatchHeaderComponent` — score, time, team badges
- `MatchTabsComponent` — tab navigation
- `MatchSummaryComponent` — events timeline (goals, cards)
- `MatchStatsComponent` — stat bars (possession, shots, xG)
- `LineupsComponent` — pitch view with player positions
- `MomentumGraphComponent` — Canvas/SVG rolling xG chart

---

## 5. Real-Time WebSocket Layer

Single WebSocket service, multiplexed across match subscriptions.

```typescript
// core/services/websocket.service.ts
import { Injectable } from '@angular/core';
import { webSocket, WebSocketSubject } from 'rxjs/webSocket';
import { Observable, EMPTY, timer } from 'rxjs';
import { retryWhen, delayWhen, tap, switchAll, catchError } from 'rxjs/operators';
import { environment } from '@env/environment';

@Injectable({ providedIn: 'root' })
export class WebSocketService {
  private socket$!: WebSocketSubject<MatchEvent>;
  private readonly WS_URL = environment.wsUrl;

  connect(): WebSocketSubject<MatchEvent> {
    if (!this.socket$ || this.socket$.closed) {
      this.socket$ = webSocket<MatchEvent>(this.WS_URL);
    }
    return this.socket$;
  }

  subscribeMatch(matchId: string): void {
    this.socket$.next({ type: 'subscribe', matchId } as any);
  }

  unsubscribeMatch(matchId: string): void {
    this.socket$.next({ type: 'unsubscribe', matchId } as any);
  }

  // Reconnect with exponential backoff
  getWithReconnect(): Observable<MatchEvent> {
    return this.connect().pipe(
      retryWhen(errors =>
        errors.pipe(
          tap(err => console.warn('WS error, reconnecting...', err)),
          delayWhen((_, attempt) => timer(Math.min(1000 * 2 ** attempt, 30000)))
        )
      ),
      catchError(() => EMPTY)
    );
  }
}
```

**In Match Detail component:**
```typescript
ngOnInit(): void {
  this.ws.subscribeMatch(this.matchId);
  this.ws.getWithReconnect().pipe(
    filter(event => event.matchId === this.matchId),
    takeUntilDestroyed(this.destroyRef)
  ).subscribe(event => {
    this.store.dispatch(updateLiveMatch({ event }));
  });
}

ngOnDestroy(): void {
  this.ws.unsubscribeMatch(this.matchId);
}
```

---

## 6. Routing Architecture

```typescript
// app-routing.module.ts
const routes: Routes = [
  { path: '', redirectTo: 'scores', pathMatch: 'full' },
  {
    path: 'scores',
    loadChildren: () => import('./features/scores/scores.module').then(m => m.ScoresModule)
  },
  {
    path: 'match/:id',
    loadChildren: () => import('./features/match-detail/match-detail.module').then(m => m.MatchDetailModule)
  },
  {
    path: 'league/:id',
    loadChildren: () => import('./features/leagues/leagues.module').then(m => m.LeaguesModule)
  },
  {
    path: 'player/:id',
    loadChildren: () => import('./features/player/player.module').then(m => m.PlayerModule)
  },
  {
    path: 'team/:id',
    loadChildren: () => import('./features/team/team.module').then(m => m.TeamModule)
  },
  {
    path: 'news',
    loadChildren: () => import('./features/news/news.module').then(m => m.NewsModule)
  },
  {
    path: 'profile',
    canActivate: [AuthGuard],
    loadChildren: () => import('./features/profile/profile.module').then(m => m.ProfileModule)
  },
  { path: '**', redirectTo: 'scores' }
];
```

**Bottom nav tabs** mirror the 5 main sections: Scores · Leagues · Favourites · News · Profile.

---

## 7. Key Components

### MatchRowComponent (dumb)
```typescript
@Component({
  selector: 'app-match-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="match-row" [class.live]="match.status === 'LIVE'">
      <span class="time">{{ match | matchTime }}</span>
      <div class="teams">
        <span class="team home">{{ match.homeTeam.name }}</span>
        <app-score-badge [match]="match"></app-score-badge>
        <span class="team away">{{ match.awayTeam.name }}</span>
      </div>
      <span class="minute" *ngIf="match.status === 'LIVE'">{{ match.minute }}'</span>
    </div>
  `
})
export class MatchRowComponent {
  @Input({ required: true }) match!: Match;
}
```

Always use `ChangeDetectionStrategy.OnPush` on dumb components — critical for performance
when rendering hundreds of live match rows.

### ScoreBadgeComponent
Renders score, handles live pulse animation, penalty shootout display.

### MomentumGraphComponent
Use `<canvas>` with Chart.js or a custom SVG path. Plot rolling xG differential over 90min.
X-axis: match minute. Y-axis: xG delta (home positive, away negative). Color bands by team.

---

## 8. API Service Layer

```typescript
// core/services/api.service.ts
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly base = environment.apiUrl;

  constructor(private http: HttpClient) {}

  getMatches(date: string): Observable<Match[]> {
    return this.http.get<Match[]>(`${this.base}/matches`, { params: { date } });
  }

  getMatchDetail(id: string): Observable<MatchDetail> {
    return this.http.get<MatchDetail>(`${this.base}/matches/${id}`);
  }

  getLeagueTable(leagueId: string): Observable<LeagueTable> {
    return this.http.get<LeagueTable>(`${this.base}/leagues/${leagueId}/table`);
  }

  getPlayer(playerId: string): Observable<Player> {
    return this.http.get<Player>(`${this.base}/players/${playerId}`);
  }

  getNews(params?: { teamId?: string; page?: number }): Observable<NewsPage> {
    return this.http.get<NewsPage>(`${this.base}/news`, { params: params as any });
  }
}
```

**Auth interceptor** attaches JWT from local storage to all requests:
```typescript
intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
  const token = this.authService.getToken();
  if (token) {
    req = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }
  return next.handle(req);
}
```

---

## 9. Performance Patterns

- **OnPush everywhere** on presentational components
- **Virtual scroll** for match lists > 50 items (Angular CDK)
- **trackBy** on all `*ngFor`: `trackBy: (_, m) => m.id`
- **Lazy load** all feature modules
- **Prefetch** match detail when user hovers a match row
- **Image lazy loading**: `loading="lazy"` on all team/player images
- **Bundle budget** in `angular.json`: set `maximumWarning: 500kb`, `maximumError: 1mb`
- **Service worker** (Angular PWA) for offline score caching

---

## 10. Angular Universal (SSR)

Enable for public-facing pages (match detail, player profiles, news) for SEO.

```bash
ng add @angular/universal
```

**Pages that benefit from SSR:**
- `/match/:id` — match result pages indexed by search engines
- `/player/:id` — player stat pages
- `/news/:id` — article pages

**Pages to exclude from SSR** (authenticated or highly dynamic):
- `/scores` — real-time, no SEO value
- `/profile` — authenticated

**Platform check pattern** (avoid `window`/`document` in SSR):
```typescript
import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID, Inject } from '@angular/core';

constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

someMethod() {
  if (isPlatformBrowser(this.platformId)) {
    // Safe to access window, document, localStorage
  }
}
```

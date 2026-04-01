# FotNob Flutter Integration Guide

Complete API reference for integrating the FotNob backend into a Flutter app.

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Endpoints](#endpoints)
   - [Users](#users)
   - [Scores](#scores)
   - [Stats](#stats)
   - [News](#news)
   - [Search](#search)
   - [Notifications](#notifications)
   - [Competitions](#competitions)
   - [Persons](#persons)
   - [Ingest (Admin)](#ingest-admin)
4. [WebSocket — Live Match Updates](#websocket--live-match-updates)
5. [Error Handling](#error-handling)
6. [Flutter Implementation Notes](#flutter-implementation-notes)
7. [Data Models (Dart)](#data-models-dart)

---

## Overview

| Property | Value |
|---|---|
| Base URL | `http://{host}:3000/api/v1` |
| Protocol | HTTP/REST + WebSocket (Socket.io) |
| Default Port | `3000` |
| Swagger Docs | `http://{host}:3000/api/docs` |
| Content-Type | `application/json` |
| Date Format | ISO 8601 strings (`2024-03-15T13:00:00.000Z`) |

---

## Authentication

### Mechanism

JWT Bearer tokens with rotation.

| Token | Lifetime | Usage |
|---|---|---|
| Access Token | 15 minutes | All protected endpoints |
| Refresh Token | 30 days | Obtain new access token |

### Request Header

```
Authorization: Bearer <accessToken>
```

### Token Lifecycle

```
Register / Login
    └─► { accessToken, refreshToken }
              │
              ▼ (access token expires after 15 min)
        POST /users/refresh  ──► { accessToken, refreshToken (rotated) }
              │
              ▼ (logout)
        POST /users/logout   ──► all refresh tokens revoked
```

### Public Endpoints (no auth required)

All endpoints under `/scores`, `/stats`, `/news`, `/search`, `/competitions`, `/persons`, `/ingest` are public. User endpoints `/register`, `/login`, `/refresh` are also public.

---

## Endpoints

### Users

#### Register

```
POST /users/register
```

**Rate limit:** 5 req/min

**Request body:**
```json
{
  "email": "user@example.com",
  "password": "minlength8",
  "displayName": "Optional Name"
}
```

**Response `201`:**
```json
{
  "tokens": {
    "accessToken": "eyJ...",
    "refreshToken": "eyJ..."
  },
  "user": {
    "id": "clx...",
    "email": "user@example.com",
    "displayName": "Optional Name",
    "avatarUrl": null,
    "locale": "en",
    "createdAt": "2024-03-15T13:00:00.000Z"
  }
}
```

**Errors:** `400` validation | `409` email already in use

---

#### Login

```
POST /users/login
```

**Rate limit:** 10 req/min

**Request body:**
```json
{
  "email": "user@example.com",
  "password": "yourpassword"
}
```

**Response `200`:** Same shape as register.

**Errors:** `400` validation | `401` invalid credentials

---

#### Refresh Token

```
POST /users/refresh
```

**Request body:**
```json
{
  "refreshToken": "eyJ..."
}
```

**Response `200`:**
```json
{
  "accessToken": "eyJ...",
  "refreshToken": "eyJ..."
}
```

> Old refresh token is revoked. Store the new one.

**Errors:** `401` invalid or expired token

---

#### Logout

```
POST /users/logout
```

**Auth required:** Yes

**Response:** `204 No Content`

Side effect: all refresh tokens for the user are revoked.

---

#### Get Current User

```
GET /users/me
```

**Auth required:** Yes

**Response `200`:**
```json
{
  "id": "clx...",
  "email": "user@example.com",
  "displayName": "Name",
  "avatarUrl": null,
  "locale": "en",
  "createdAt": "2024-03-15T13:00:00.000Z"
}
```

---

#### Get Favourites

```
GET /users/me/favourites
```

**Auth required:** Yes

**Response `200`:**
```json
{
  "teamIds": ["clx...", "clx..."],
  "leagueIds": ["clx..."],
  "playerIds": []
}
```

---

#### Update Favourites

```
PUT /users/me/favourites
```

**Auth required:** Yes

**Request body** (all fields optional, replaces existing list when provided):
```json
{
  "teamIds": ["clx...", "clx..."],
  "leagueIds": ["clx..."],
  "playerIds": ["clx..."]
}
```

**Response `200`:** Same shape as GET favourites.

---

### Scores

#### Get Matches by Date

```
GET /scores/matches?date=YYYY-MM-DD
```

**Rate limit:** 60 req/min

**Query params:**

| Param | Type | Required | Default |
|---|---|---|---|
| `date` | `YYYY-MM-DD` | No | today |

**Response `200`:**
```json
[
  {
    "leagueId": "clx...",
    "leagueName": "Premier League",
    "logoUrl": "https://...",
    "matches": [
      {
        "id": "clx...",
        "homeScore": 2,
        "awayScore": 1,
        "status": "FINISHED",
        "minute": null,
        "kickoffTime": "2024-03-15T15:00:00.000Z",
        "venue": "Anfield",
        "round": "Matchday 28",
        "homeTeam": {
          "id": "clx...",
          "name": "Liverpool",
          "shortName": "LIV",
          "logoUrl": "https://..."
        },
        "awayTeam": {
          "id": "clx...",
          "name": "Arsenal",
          "shortName": "ARS",
          "logoUrl": "https://..."
        }
      }
    ]
  }
]
```

**Match status values:** `SCHEDULED` | `LIVE` | `HALFTIME` | `FINISHED` | `POSTPONED` | `CANCELLED`

---

#### Get Single Match

```
GET /scores/matches/:id
```

**Response `200`:** Single match object (same shape as item in the list above).

**Errors:** `404` match not found

---

#### Get Match Events

```
GET /scores/matches/:id/events
```

**Response `200`:**
```json
[
  {
    "id": "clx...",
    "matchId": "clx...",
    "type": "GOAL",
    "minute": 34,
    "addedTime": null,
    "teamId": "clx...",
    "playerId": "clx...",
    "assistPlayerId": "clx...",
    "detail": "Header",
    "homeScoreAfter": 1,
    "awayScoreAfter": 0
  }
]
```

**Event type values:** `GOAL` | `OWN_GOAL` | `YELLOW_CARD` | `SECOND_YELLOW` | `RED_CARD` | `SUBSTITUTION` | `PENALTY_SCORED` | `PENALTY_MISSED` | `VAR_REVIEW`

---

### Stats

#### Get Match Statistics

```
GET /stats/matches/:id
```

**Response `200`:**
```json
{
  "matchId": "clx...",
  "possession": { "home": 58.3, "away": 41.7 },
  "shots": { "home": 14, "away": 8 },
  "shotsOnTarget": { "home": 6, "away": 3 },
  "xG": { "home": 1.82, "away": 0.74 },
  "corners": { "home": 7, "away": 3 },
  "fouls": { "home": 10, "away": 14 },
  "passAccuracy": { "home": 88.1, "away": 79.4 },
  "momentumData": null
}
```

---

#### Get Player Ratings for Match

```
GET /stats/matches/:id/ratings
```

**Response `200`:**
```json
[
  {
    "playerId": "clx...",
    "rating": 8.2,
    "minutes": 90,
    "goals": 1,
    "assists": 1
  }
]
```

---

#### Get League Table (Standings)

```
GET /stats/leagues/:id/table
```

**Response `200`:**
```json
[
  {
    "position": 1,
    "teamId": "clx...",
    "teamName": "Arsenal",
    "teamLogo": "https://...",
    "played": 28,
    "won": 20,
    "drawn": 5,
    "lost": 3,
    "goalsFor": 68,
    "goalsAgainst": 24,
    "points": 65,
    "form": "W W D W W"
  }
]
```

---

#### Get Team Form

```
GET /stats/teams/:id/form
```

**Response `200`:**
```json
["W", "W", "D", "L", "W"]
```

Most recent result last.

---

### News

#### List Articles

```
GET /news
```

**Query params:**

| Param | Type | Required | Default |
|---|---|---|---|
| `teamId` | string | No | — |
| `leagueId` | string | No | — |
| `page` | int | No | 1 |
| `limit` | int (max 50) | No | 20 |

**Response `200`:**
```json
{
  "items": [
    {
      "id": "clx...",
      "title": "Arsenal sign new striker",
      "sourceUrl": "https://...",
      "imageUrl": "https://...",
      "aiSummary": "Arsenal have completed the signing of...",
      "teamId": "clx...",
      "leagueId": null,
      "publishedAt": "2024-03-15T12:00:00.000Z",
      "status": "SUMMARISED"
    }
  ],
  "total": 250,
  "page": 1,
  "limit": 20
}
```

**Article status values:** `PENDING_SUMMARY` | `SUMMARISED` | `FAILED`

---

#### Get Single Article

```
GET /news/:id
```

**Response `200`:** Single article object.

**Errors:** `404` not found

---

### Search

#### Global Search

```
GET /search?q=arsenal&type=teams
```

**Rate limit:** 30 req/min

**Query params:**

| Param | Type | Required | Default |
|---|---|---|---|
| `q` | string (1–200 chars) | Yes | — |
| `type` | `all` \| `players` \| `teams` \| `leagues` | No | `all` |

**Response `200`:**
```json
{
  "results": [
    {
      "id": "clx...",
      "name": "Arsenal",
      "type": "team",
      "subtitle": "Premier League",
      "imageUrl": "https://..."
    }
  ],
  "total": 3
}
```

**Result type values:** `player` | `team` | `league`

---

### Notifications

#### Register FCM Token

```
POST /notifications/fcm-tokens
```

**Auth required:** Yes

**Request body:**
```json
{
  "token": "fcm-device-token-string",
  "platform": "android"
}
```

**Platform values:** `android` | `ios`

**Response:** `204 No Content`

---

#### Remove FCM Token

```
DELETE /notifications/fcm-tokens/:token
```

**Auth required:** Yes

**Response:** `204 No Content`

Call this on logout or when the user disables notifications.

---

#### Get Notification Preferences

```
GET /notifications/prefs
```

**Auth required:** Yes

**Response `200`:**
```json
{
  "goals": true,
  "kickoff": true,
  "lineups": false,
  "finalWhistle": true,
  "news": false
}
```

---

#### Update Notification Preferences

```
PUT /notifications/prefs
```

**Auth required:** Yes

**Request body** (all fields optional):
```json
{
  "goals": true,
  "kickoff": false,
  "lineups": true,
  "finalWhistle": true,
  "news": true
}
```

**Response `200`:** Same shape as GET prefs.

---

### Competitions

#### Get Competition Info

```
GET /competitions/:code
```

**Path params:** `code` — league code, e.g. `PL`, `CL`, `PD`, `SA` (case-insensitive)

**Response `200`:**
```json
{
  "id": 2790,
  "name": "Premier League",
  "code": "PL",
  "type": "LEAGUE",
  "emblem": "https://...",
  "country": "England",
  "currentMatchday": 28
}
```

---

#### Get Top Scorers

```
GET /competitions/:code/scorers?limit=10&season=2024
```

**Query params:**

| Param | Type | Required | Default |
|---|---|---|---|
| `limit` | int (max 50) | No | 10 |
| `season` | int (4-digit year) | No | current |

**Response `200`:**
```json
[
  {
    "playerId": 1234,
    "playerName": "Erling Haaland",
    "nationality": "Norwegian",
    "position": "Striker",
    "teamId": 65,
    "teamName": "Manchester City",
    "teamCrest": "https://...",
    "goals": 26,
    "assists": 5,
    "penalties": 4,
    "playedMatches": 28
  }
]
```

---

#### Get Head-to-Head

```
GET /competitions/:code/head2head/:matchId?limit=10
```

**Query params:**

| Param | Type | Required | Default |
|---|---|---|---|
| `limit` | int | No | 10 |

**Response `200`:**
```json
{
  "numberOfMatches": 24,
  "totalGoals": 68,
  "home": {
    "id": 1,
    "name": "Arsenal",
    "wins": 10,
    "draws": 4,
    "losses": 10
  },
  "away": {
    "id": 57,
    "name": "Tottenham",
    "wins": 10,
    "draws": 4,
    "losses": 10
  },
  "recentMatches": [
    {
      "id": 12345,
      "utcDate": "2024-03-15T15:00:00.000Z",
      "status": "FINISHED",
      "homeTeam": { "id": 1, "name": "Arsenal", "crest": "https://..." },
      "awayTeam": { "id": 57, "name": "Tottenham", "crest": "https://..." },
      "score": {
        "fullTime": { "home": 2, "away": 1 },
        "halfTime": { "home": 1, "away": 0 }
      }
    }
  ]
}
```

---

### Persons

#### Get Person Matches

```
GET /persons/:personId/matches
```

**Path params:** `personId` — integer ID from football-data.org

**Query params:**

| Param | Type | Required |
|---|---|---|
| `dateFrom` | `YYYY-MM-DD` | No |
| `dateTo` | `YYYY-MM-DD` | No |
| `limit` | int | No |

**Response `200`:** Array of match objects.

---

### Ingest (Admin)

These endpoints trigger data synchronization from the external football API. They are public but intended for admin/cron use only — do not expose in the Flutter UI.

| Method | Path | Query Params | Description |
|---|---|---|---|
| `POST` | `/ingest/fixtures` | `date` (YYYY-MM-DD, default today) | Sync fixtures for a date |
| `POST` | `/ingest/standings` | — | Sync all standings |
| `POST` | `/ingest/competitions` | — | Sync competition metadata |
| `POST` | `/ingest/scorers` | — | Sync top scorers |
| `POST` | `/ingest/team-matches` | `teamId` (required), `season` | Sync a team's match history |

---

## WebSocket — Live Match Updates

**Library:** Use [`socket_io_client`](https://pub.dev/packages/socket_io_client) in Flutter.

**Namespace:** `/live`

**Connection:**
```dart
import 'package:socket_io_client/socket_io_client.dart' as IO;

final socket = IO.io(
  'http://{host}:3000/live',
  IO.OptionBuilder()
    .setTransports(['websocket'])
    .build(),
);
```

### Events

#### Subscribe to a match

```dart
socket.emit('subscribe', {'matchId': 'clx...'});
```

#### Receive match events (goals, cards, substitutions, etc.)

```dart
socket.on('matchEvent', (data) {
  // data: { matchId, type, minute, ... } — same shape as /scores/matches/:id/events items
  print(data);
});
```

#### Receive match finished signal

```dart
socket.on('matchFinished', (data) {
  // data: { matchId: 'clx...' }
});
```

#### Keep-alive ping

```dart
socket.emit('ping');
socket.on('pong', (_) { /* connection alive */ });
```

#### Unsubscribe

```dart
socket.emit('unsubscribe', {'matchId': 'clx...'});
```

---

## Error Handling

All error responses share this shape:

```json
{
  "statusCode": 400,
  "message": "email must be a valid email address",
  "error": "BadRequest",
  "path": "/api/v1/users/register",
  "timestamp": "2024-03-15T13:00:00.000Z"
}
```

`message` may be a string or an array of strings (validation errors).

| Status | Meaning |
|---|---|
| `400` | Validation error — check `message` array |
| `401` | Missing/invalid/expired token |
| `404` | Resource not found |
| `409` | Conflict (e.g. email already registered) |
| `429` | Rate limit exceeded — back off and retry |
| `500` | Server error |

---

## Flutter Implementation Notes

### Recommended Packages

```yaml
dependencies:
  dio: ^5.4.0                    # HTTP client
  flutter_secure_storage: ^9.0.0 # Store tokens securely
  socket_io_client: ^2.0.3       # WebSocket / Socket.io
  firebase_messaging: ^14.0.0    # FCM push notifications
  intl: ^0.19.0                  # Date formatting
```

### Token Storage

```dart
const _storage = FlutterSecureStorage();

Future<void> saveTokens(String access, String refresh) async {
  await _storage.write(key: 'access_token', value: access);
  await _storage.write(key: 'refresh_token', value: refresh);
}

Future<String?> getAccessToken() => _storage.read(key: 'access_token');
Future<String?> getRefreshToken() => _storage.read(key: 'refresh_token');
```

### Auto-Refresh Interceptor (Dio)

Access tokens expire in 15 minutes. Use a Dio interceptor to refresh automatically:

```dart
dio.interceptors.add(
  InterceptorsWrapper(
    onRequest: (options, handler) async {
      final token = await getAccessToken();
      if (token != null) options.headers['Authorization'] = 'Bearer $token';
      return handler.next(options);
    },
    onError: (error, handler) async {
      if (error.response?.statusCode == 401) {
        final refreshed = await refreshTokens();
        if (refreshed) {
          // Retry original request with new token
          final token = await getAccessToken();
          error.requestOptions.headers['Authorization'] = 'Bearer $token';
          final response = await dio.fetch(error.requestOptions);
          return handler.resolve(response);
        }
      }
      return handler.next(error);
    },
  ),
);
```

### FCM Setup Flow

1. Request notification permission on app start.
2. Get the FCM token: `FirebaseMessaging.instance.getToken()`.
3. After login, `POST /notifications/fcm-tokens` with the token and platform.
4. On logout, `DELETE /notifications/fcm-tokens/:token` then call `POST /users/logout`.
5. Listen for token refresh: `FirebaseMessaging.instance.onTokenRefresh`.

### Date Handling

All dates are ISO 8601 UTC strings. Parse with:

```dart
final kickoff = DateTime.parse(match['kickoffTime']).toLocal();
```

### Pagination (News)

```dart
Future<List<Article>> fetchNews({int page = 1, String? teamId}) async {
  final res = await dio.get('/news', queryParameters: {
    'page': page,
    'limit': 20,
    if (teamId != null) 'teamId': teamId,
  });
  // res.data['items'], res.data['total'], res.data['page']
}
```

---

## Data Models (Dart)

Minimal Dart classes matching the core API response shapes. Add `fromJson` factories as needed.

```dart
class AuthTokens {
  final String accessToken;
  final String refreshToken;
}

class UserProfile {
  final String id;
  final String email;
  final String? displayName;
  final String? avatarUrl;
  final String locale;
  final DateTime createdAt;
}

class MatchSummary {
  final String id;
  final int homeScore;
  final int awayScore;
  final String status; // SCHEDULED | LIVE | HALFTIME | FINISHED | POSTPONED | CANCELLED
  final int? minute;
  final DateTime kickoffTime;
  final String? venue;
  final String? round;
  final TeamSummary homeTeam;
  final TeamSummary awayTeam;
}

class TeamSummary {
  final String id;
  final String name;
  final String shortName;
  final String? logoUrl;
}

class MatchEvent {
  final String id;
  final String matchId;
  final String type; // GOAL | OWN_GOAL | YELLOW_CARD | ...
  final int minute;
  final int? addedTime;
  final String teamId;
  final String playerId;
  final String? assistPlayerId;
  final String? detail;
  final int? homeScoreAfter;
  final int? awayScoreAfter;
}

class MatchStats {
  final String matchId;
  final ({double? home, double? away}) possession;
  final ({int? home, int? away}) shots;
  final ({int? home, int? away}) shotsOnTarget;
  final ({double? home, double? away}) xG;
  final ({int? home, int? away}) corners;
  final ({int? home, int? away}) fouls;
  final ({double? home, double? away}) passAccuracy;
}

class StandingRow {
  final int position;
  final String teamId;
  final String teamName;
  final String? teamLogo;
  final int played;
  final int won;
  final int drawn;
  final int lost;
  final int goalsFor;
  final int goalsAgainst;
  final int points;
  final String? form;
}

class Article {
  final String id;
  final String title;
  final String sourceUrl;
  final String? imageUrl;
  final String? aiSummary;
  final String? teamId;
  final String? leagueId;
  final DateTime publishedAt;
  final String status; // PENDING_SUMMARY | SUMMARISED | FAILED
}

class SearchResult {
  final String id;
  final String name;
  final String type; // player | team | league
  final String? subtitle;
  final String? imageUrl;
}

class NotificationPrefs {
  final bool goals;
  final bool kickoff;
  final bool lineups;
  final bool finalWhistle;
  final bool news;
}

class Favourites {
  final List<String> teamIds;
  final List<String> leagueIds;
  final List<String> playerIds;
}
```

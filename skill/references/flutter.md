# Flutter Mobile Reference

Full implementation guide for the FotMob-clone mobile app using Flutter.

---

## Table of Contents
1. [Project Setup](#1-project-setup)
2. [Project Structure](#2-project-structure)
3. [State Management — BLoC](#3-state-management--bloc)
4. [Feature Structure](#4-feature-structure)
5. [Real-Time WebSocket Layer](#5-real-time-websocket-layer)
6. [Push Notifications](#6-push-notifications)
7. [Navigation — go_router](#7-navigation--go_router)
8. [Key Widgets](#8-key-widgets)
9. [Data Layer — Repository Pattern](#9-data-layer--repository-pattern)
10. [Offline Support](#10-offline-support)
11. [Stats Visualisations](#11-stats-visualisations)
12. [Platform Channels](#12-platform-channels)

---

## 1. Project Setup

```bash
flutter create fotmob_mobile --org com.yourcompany --platforms ios,android
cd fotmob_mobile
```

### pubspec.yaml dependencies

```yaml
dependencies:
  flutter:
    sdk: flutter

  # State management
  flutter_bloc: ^8.1.3
  equatable: ^2.0.5           # Value equality for BLoC states/events

  # Navigation
  go_router: ^13.0.0

  # Networking
  dio: ^5.4.0                 # HTTP client with interceptors
  web_socket_channel: ^2.4.0  # WebSocket

  # Push notifications
  firebase_core: ^2.24.0
  firebase_messaging: ^14.7.9
  flutter_local_notifications: ^16.3.0

  # Local storage / offline
  hive_flutter: ^1.1.0        # Key-value cache
  isar: ^3.1.0                # Local DB for complex queries (optional, heavier)

  # UI & charts
  fl_chart: ^0.66.0           # Stats charts (xG, momentum)
  cached_network_image: ^3.3.1
  shimmer: ^3.0.0             # Loading skeleton

  # Utilities
  intl: ^0.19.0
  freezed_annotation: ^2.4.1  # Immutable data classes
  json_annotation: ^4.8.1

dev_dependencies:
  flutter_test:
    sdk: flutter
  bloc_test: ^9.1.5
  freezed: ^2.4.6
  json_serializable: ^6.7.1
  hive_generator: ^2.0.1
  build_runner: ^2.4.7
```

---

## 2. Project Structure

Clean Architecture: data → domain → presentation.

```
lib/
├── main.dart
├── app.dart                    # MaterialApp + go_router setup
├── core/
│   ├── constants/
│   │   ├── api_constants.dart  # Base URLs, endpoints
│   │   └── app_colors.dart     # Design tokens
│   ├── network/
│   │   ├── dio_client.dart     # Dio singleton + interceptors
│   │   └── websocket_client.dart
│   ├── error/
│   │   └── failures.dart       # Typed failures (NetworkFailure, etc.)
│   └── utils/
│       ├── date_utils.dart
│       └── rating_utils.dart
│
├── features/
│   ├── scores/
│   │   ├── data/
│   │   │   ├── models/         # JSON-serialisable DTOs (freezed)
│   │   │   ├── sources/        # Remote + local data sources
│   │   │   └── repositories/   # Implementation of domain repo interface
│   │   ├── domain/
│   │   │   ├── entities/       # Pure Dart domain objects
│   │   │   ├── repositories/   # Abstract interfaces
│   │   │   └── usecases/       # GetMatchesByDate, SubscribeToLiveMatch
│   │   └── presentation/
│   │       ├── bloc/           # ScoresBloc, ScoresEvent, ScoresState
│   │       ├── pages/          # ScoresPage
│   │       └── widgets/        # MatchCard, LeagueSection, DatePicker
│   │
│   ├── match_detail/
│   ├── leagues/
│   ├── player/
│   ├── team/
│   ├── news/
│   └── profile/
│
├── shared/
│   ├── widgets/
│   │   ├── score_badge.dart
│   │   ├── team_logo.dart
│   │   ├── player_avatar.dart
│   │   └── loading_skeleton.dart
│   └── bloc/
│       └── app_bloc_observer.dart
│
└── injection_container.dart    # get_it service locator (optional)
```

---

## 3. State Management — BLoC

### Scores BLoC (example)

```dart
// features/scores/presentation/bloc/scores_bloc.dart

// Events
abstract class ScoresEvent extends Equatable {}

class LoadMatchesByDate extends ScoresEvent {
  final DateTime date;
  const LoadMatchesByDate(this.date);
  @override List<Object> get props => [date];
}

class LiveMatchEventReceived extends ScoresEvent {
  final MatchEvent event;
  const LiveMatchEventReceived(this.event);
  @override List<Object> get props => [event];
}

// States
abstract class ScoresState extends Equatable {}
class ScoresInitial extends ScoresState { @override List<Object> get props => []; }
class ScoresLoading extends ScoresState { @override List<Object> get props => []; }
class ScoresLoaded extends ScoresState {
  final List<LeagueGroup> groups;
  final DateTime selectedDate;
  const ScoresLoaded({required this.groups, required this.selectedDate});
  @override List<Object> get props => [groups, selectedDate];
}
class ScoresError extends ScoresState {
  final String message;
  const ScoresError(this.message);
  @override List<Object> get props => [message];
}

// BLoC
class ScoresBloc extends Bloc<ScoresEvent, ScoresState> {
  final GetMatchesByDate getMatchesByDate;
  final WebSocketClient wsClient;
  StreamSubscription? _liveSubscription;

  ScoresBloc({required this.getMatchesByDate, required this.wsClient})
      : super(ScoresInitial()) {

    on<LoadMatchesByDate>(_onLoad);
    on<LiveMatchEventReceived>(_onLiveEvent);
  }

  Future<void> _onLoad(LoadMatchesByDate event, Emitter<ScoresState> emit) async {
    emit(ScoresLoading());
    final result = await getMatchesByDate(event.date);
    result.fold(
      (failure) => emit(ScoresError(failure.message)),
      (groups) {
        emit(ScoresLoaded(groups: groups, selectedDate: event.date));
        _subscribeLiveMatches(groups.expand((g) => g.matches)
          .where((m) => m.status == MatchStatus.live)
          .map((m) => m.id).toList());
      },
    );
  }

  void _subscribeLiveMatches(List<String> matchIds) {
    _liveSubscription?.cancel();
    _liveSubscription = wsClient.subscribeToMatches(matchIds).listen(
      (event) => add(LiveMatchEventReceived(event)),
    );
  }

  void _onLiveEvent(LiveMatchEventReceived event, Emitter<ScoresState> emit) {
    if (state is ScoresLoaded) {
      final current = state as ScoresLoaded;
      // Update the relevant match in groups
      final updated = _applyEvent(current.groups, event.event);
      emit(ScoresLoaded(groups: updated, selectedDate: current.selectedDate));
    }
  }

  @override
  Future<void> close() {
    _liveSubscription?.cancel();
    return super.close();
  }
}
```

---

## 4. Feature Structure

### ScoresPage

```dart
class ScoresPage extends StatelessWidget {
  const ScoresPage({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => ScoresBloc(...)..add(LoadMatchesByDate(DateTime.now())),
      child: const ScoresView(),
    );
  }
}

class ScoresView extends StatelessWidget {
  const ScoresView({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Scores')),
      body: Column(
        children: [
          const DatePickerWidget(),       // Horizontal date scroller
          Expanded(
            child: BlocBuilder<ScoresBloc, ScoresState>(
              builder: (context, state) {
                if (state is ScoresLoading) return const LoadingSkeleton();
                if (state is ScoresError) return ErrorView(message: state.message);
                if (state is ScoresLoaded) {
                  return ListView.builder(
                    itemCount: state.groups.length,
                    itemBuilder: (_, i) => LeagueSectionWidget(group: state.groups[i]),
                  );
                }
                return const SizedBox.shrink();
              },
            ),
          ),
        ],
      ),
    );
  }
}
```

### MatchDetailPage

Tabs: Summary | Stats | Lineups | Timeline

```dart
class MatchDetailPage extends StatelessWidget {
  final String matchId;

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 4,
      child: Scaffold(
        appBar: AppBar(
          bottom: const TabBar(tabs: [
            Tab(text: 'Summary'),
            Tab(text: 'Stats'),
            Tab(text: 'Lineups'),
            Tab(text: 'Timeline'),
          ]),
        ),
        body: TabBarView(children: [
          MatchSummaryTab(matchId: matchId),
          MatchStatsTab(matchId: matchId),
          LineupsTab(matchId: matchId),
          TimelineTab(matchId: matchId),
        ]),
      ),
    );
  }
}
```

---

## 5. Real-Time WebSocket Layer

```dart
// core/network/websocket_client.dart
import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';

class WebSocketClient {
  WebSocketChannel? _channel;
  final _controller = StreamController<MatchEvent>.broadcast();
  final String _baseUrl;
  Timer? _reconnectTimer;

  WebSocketClient({required String baseUrl}) : _baseUrl = baseUrl;

  void connect() {
    try {
      _channel = WebSocketChannel.connect(Uri.parse(_baseUrl));
      _channel!.stream.listen(
        (data) {
          final event = MatchEvent.fromJson(jsonDecode(data as String));
          _controller.add(event);
        },
        onDone: _scheduleReconnect,
        onError: (_) => _scheduleReconnect(),
      );
    } catch (_) {
      _scheduleReconnect();
    }
  }

  void subscribeToMatch(String matchId) {
    _channel?.sink.add(jsonEncode({'type': 'subscribe', 'matchId': matchId}));
  }

  void unsubscribeFromMatch(String matchId) {
    _channel?.sink.add(jsonEncode({'type': 'unsubscribe', 'matchId': matchId}));
  }

  Stream<MatchEvent> subscribeToMatches(List<String> matchIds) {
    for (final id in matchIds) { subscribeToMatch(id); }
    return _controller.stream.where((e) => matchIds.contains(e.matchId));
  }

  void _scheduleReconnect() {
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(const Duration(seconds: 5), connect);
  }

  void dispose() {
    _reconnectTimer?.cancel();
    _channel?.sink.close();
    _controller.close();
  }
}
```

---

## 6. Push Notifications

### Setup

```bash
# Add Firebase to your Flutter project
flutterfire configure
```

```dart
// main.dart
void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  await NotificationService.init();
  runApp(const App());
}
```

### NotificationService

```dart
class NotificationService {
  static final _localNotifications = FlutterLocalNotificationsPlugin();

  static Future<void> init() async {
    // Request permission
    await FirebaseMessaging.instance.requestPermission(
      alert: true, badge: true, sound: true,
    );

    // Local notification setup (for foreground display)
    const androidSettings = AndroidInitializationSettings('@mipmap/ic_launcher');
    const iosSettings = DarwinInitializationSettings();
    await _localNotifications.initialize(
      const InitializationSettings(android: androidSettings, iOS: iosSettings),
      onDidReceiveNotificationResponse: _onTap,
    );

    // Foreground handler — show local notification
    FirebaseMessaging.onMessage.listen((message) {
      _showLocalNotification(message);
    });

    // Background tap handler — navigate to match
    FirebaseMessaging.onMessageOpenedApp.listen(_handleDeepLink);

    // Get FCM token and send to backend
    final token = await FirebaseMessaging.instance.getToken();
    if (token != null) await _registerToken(token);

    // Token refresh
    FirebaseMessaging.instance.onTokenRefresh.listen(_registerToken);
  }

  static void _onTap(NotificationResponse response) {
    // Parse payload and navigate
    if (response.payload != null) {
      final data = jsonDecode(response.payload!);
      _navigate(data);
    }
  }

  static void _handleDeepLink(RemoteMessage message) {
    _navigate(message.data);
  }

  static void _navigate(Map<String, dynamic> data) {
    final type = data['type'];
    final matchId = data['matchId'];
    if (type == 'goal' && matchId != null) {
      // Use go_router to navigate
      AppRouter.router.push('/match/$matchId');
    }
  }

  static Future<void> _showLocalNotification(RemoteMessage message) async {
    final notification = message.notification;
    if (notification == null) return;
    await _localNotifications.show(
      notification.hashCode,
      notification.title,
      notification.body,
      const NotificationDetails(
        android: AndroidNotificationDetails('scores', 'Live Scores',
          importance: Importance.high, priority: Priority.high),
        iOS: DarwinNotificationDetails(),
      ),
      payload: jsonEncode(message.data),
    );
  }

  static Future<void> _registerToken(String token) async {
    // POST token to your User service
    await DioClient.instance.post('/users/me/fcm-token', data: {'token': token});
  }
}
```

---

## 7. Navigation — go_router

```dart
// app.dart
final router = GoRouter(
  initialLocation: '/scores',
  routes: [
    ShellRoute(                        // Bottom nav shell
      builder: (ctx, state, child) => MainShell(child: child),
      routes: [
        GoRoute(path: '/scores',   builder: (_, __) => const ScoresPage()),
        GoRoute(path: '/leagues',  builder: (_, __) => const LeaguesPage()),
        GoRoute(path: '/favourites', builder: (_, __) => const FavouritesPage()),
        GoRoute(path: '/news',     builder: (_, __) => const NewsPage()),
        GoRoute(path: '/profile',  builder: (_, __) => const ProfilePage()),
      ],
    ),
    GoRoute(
      path: '/match/:id',
      builder: (_, state) => MatchDetailPage(matchId: state.pathParameters['id']!),
    ),
    GoRoute(
      path: '/player/:id',
      builder: (_, state) => PlayerPage(playerId: state.pathParameters['id']!),
    ),
    GoRoute(
      path: '/team/:id',
      builder: (_, state) => TeamPage(teamId: state.pathParameters['id']!),
    ),
  ],
  redirect: (ctx, state) {
    // Auth guard for /profile
    final loggedIn = AuthBloc.of(ctx).state is Authenticated;
    if (state.matchedLocation == '/profile' && !loggedIn) return '/scores';
    return null;
  },
);
```

### Bottom nav shell
```dart
class MainShell extends StatelessWidget {
  final Widget child;
  final _tabs = ['/scores', '/leagues', '/favourites', '/news', '/profile'];

  @override
  Widget build(BuildContext context) {
    final location = GoRouterState.of(context).matchedLocation;
    final index = _tabs.indexWhere((t) => location.startsWith(t));

    return Scaffold(
      body: child,
      bottomNavigationBar: NavigationBar(
        selectedIndex: index < 0 ? 0 : index,
        onDestinationSelected: (i) => context.go(_tabs[i]),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.sports_soccer), label: 'Scores'),
          NavigationDestination(icon: Icon(Icons.emoji_events), label: 'Leagues'),
          NavigationDestination(icon: Icon(Icons.star), label: 'Favourites'),
          NavigationDestination(icon: Icon(Icons.article), label: 'News'),
          NavigationDestination(icon: Icon(Icons.person), label: 'Profile'),
        ],
      ),
    );
  }
}
```

---

## 8. Key Widgets

### MatchCard

```dart
class MatchCard extends StatelessWidget {
  final Match match;
  const MatchCard({super.key, required this.match});

  @override
  Widget build(BuildContext context) {
    return ListTile(
      onTap: () => context.push('/match/${match.id}'),
      leading: _MatchTime(match: match),
      title: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          TeamNameWidget(team: match.homeTeam, alignment: TextAlign.right),
          ScoreBadge(match: match),
          TeamNameWidget(team: match.awayTeam, alignment: TextAlign.left),
        ],
      ),
      trailing: match.status == MatchStatus.live
        ? _LivePulse()
        : const SizedBox.shrink(),
    );
  }
}
```

### LivePulse (animated indicator)

```dart
class _LivePulse extends StatefulWidget {
  @override State<_LivePulse> createState() => _LivePulseState();
}

class _LivePulseState extends State<_LivePulse>
    with SingleTickerProviderStateMixin {
  late AnimationController _ctrl;
  late Animation<double> _opacity;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(vsync: this, duration: const Duration(seconds: 1))
      ..repeat(reverse: true);
    _opacity = Tween(begin: 0.3, end: 1.0).animate(_ctrl);
  }

  @override
  Widget build(BuildContext context) => FadeTransition(
    opacity: _opacity,
    child: Container(
      width: 8, height: 8,
      decoration: const BoxDecoration(color: Colors.green, shape: BoxShape.circle),
    ),
  );

  @override
  void dispose() { _ctrl.dispose(); super.dispose(); }
}
```

---

## 9. Data Layer — Repository Pattern

```dart
// Abstract interface (domain layer)
abstract class MatchRepository {
  Future<Either<Failure, List<LeagueGroup>>> getMatchesByDate(DateTime date);
  Future<Either<Failure, MatchDetail>> getMatchDetail(String id);
  Stream<MatchEvent> getLiveEvents(String matchId);
}

// Implementation (data layer)
class MatchRepositoryImpl implements MatchRepository {
  final MatchRemoteSource remote;
  final MatchLocalSource local;     // Hive cache

  @override
  Future<Either<Failure, List<LeagueGroup>>> getMatchesByDate(DateTime date) async {
    try {
      // Try cache first for non-live dates
      final cached = await local.getMatchesByDate(date);
      if (cached != null && !_isToday(date)) return Right(cached);

      final dtos = await remote.fetchMatchesByDate(date);
      final groups = _groupByLeague(dtos.map((d) => d.toDomain()).toList());
      await local.cacheMatchesByDate(date, groups);
      return Right(groups);
    } on DioException catch (e) {
      return Left(NetworkFailure(e.message ?? 'Network error'));
    }
  }
}
```

Use `either` package or `dartz` for the `Either` type in use cases.

---

## 10. Offline Support

Use Hive for lightweight caching of:
- Today's matches (TTL: 30s for live, 5min for finished)
- Favourite team results (TTL: 1h)
- News articles (TTL: 15min)
- User preferences (no expiry)

```dart
// Hive box setup
@HiveType(typeId: 0)
class CachedMatch extends HiveObject {
  @HiveField(0) late String id;
  @HiveField(1) late String json;    // serialised Match
  @HiveField(2) late DateTime cachedAt;
}

// Cache write
await Hive.box<CachedMatch>('matches').put(date.toString(), CachedMatch()
  ..id = date.toString()
  ..json = jsonEncode(groups.map((g) => g.toJson()).toList())
  ..cachedAt = DateTime.now());

// Cache read with TTL check
final cached = Hive.box<CachedMatch>('matches').get(date.toString());
if (cached != null && DateTime.now().difference(cached.cachedAt).inMinutes < 5) {
  return jsonDecode(cached.json) as List;
}
```

**Connectivity handling:**
```dart
import 'package:connectivity_plus/connectivity_plus.dart';

final connectivity = await Connectivity().checkConnectivity();
if (connectivity == ConnectivityResult.none) {
  return Left(const NetworkFailure('No internet connection'));
}
```

---

## 11. Stats Visualisations

### fl_chart — possession bar

```dart
BarChart(
  BarChartData(
    barGroups: [
      BarChartGroupData(x: 0, barRods: [
        BarChartRodData(toY: match.stats.possessionHome, color: homeColor, width: 20),
      ]),
      BarChartGroupData(x: 1, barRods: [
        BarChartRodData(toY: match.stats.possessionAway, color: awayColor, width: 20),
      ]),
    ],
    maxY: 100,
    titlesData: FlTitlesData(show: false),
    borderData: FlBorderData(show: false),
  ),
)
```

### Momentum graph — custom CustomPainter

For the rolling xG momentum graph, use a `CustomPainter` for full control:

```dart
class MomentumPainter extends CustomPainter {
  final List<MomentumPoint> points;
  final Color homeColor;
  final Color awayColor;

  @override
  void paint(Canvas canvas, Size size) {
    // Draw centre baseline
    final baseY = size.height / 2;
    canvas.drawLine(Offset(0, baseY), Offset(size.width, baseY),
      Paint()..color = Colors.grey.shade300..strokeWidth = 1);

    // Draw xG delta path
    final path = Path();
    for (var i = 0; i < points.length; i++) {
      final x = (points[i].minute / 90) * size.width;
      final y = baseY - (points[i].delta * size.height * 0.4);  // scale delta
      i == 0 ? path.moveTo(x, y) : path.lineTo(x, y);
    }
    canvas.drawPath(path, Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..color = homeColor);
  }

  @override
  bool shouldRepaint(MomentumPainter old) => old.points != points;
}
```

---

## 12. Platform Channels

Use platform channels for features that need native APIs:

### iOS — Live Activities (score on Dynamic Island)
```dart
const _channel = MethodChannel('com.yourapp/live_activity');

Future<void> startLiveActivity(Match match) async {
  await _channel.invokeMethod('startActivity', {
    'matchId': match.id,
    'homeTeam': match.homeTeam.name,
    'awayTeam': match.awayTeam.name,
    'score': '${match.homeScore}-${match.awayScore}',
  });
}
```

### Android — Widget (score on home screen)
Use `home_widget` package:
```dart
await HomeWidget.saveWidgetData<String>('matchScore', '2-1');
await HomeWidget.updateWidget(name: 'ScoreWidgetProvider');
```

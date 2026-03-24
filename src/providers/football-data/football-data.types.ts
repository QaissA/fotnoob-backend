// Raw API-Football (RapidAPI) response shapes

export interface ApiFootballFixture {
  fixture: {
    id: number;
    referee: string | null;
    timezone: string;
    date: string; // ISO 8601
    timestamp: number;
    status: {
      long: string;
      short: string; // 'NS' | '1H' | 'HT' | '2H' | 'FT' | 'PST' | 'CANC'
      elapsed: number | null;
    };
    venue: { id: number | null; name: string | null; city: string | null };
  };
  league: {
    id: number;
    name: string;
    country: string;
    logo: string;
    season: number;
    round: string;
  };
  teams: {
    home: ApiFootballTeam;
    away: ApiFootballTeam;
  };
  goals: { home: number | null; away: number | null };
}

export interface ApiFootballTeam {
  id: number;
  name: string;
  logo: string;
  winner: boolean | null;
}

export interface ApiFootballEvent {
  time: { elapsed: number; extra: number | null };
  team: { id: number; name: string };
  player: { id: number; name: string };
  assist: { id: number | null; name: string | null };
  type: string; // 'Goal' | 'Card' | 'subst' | 'Var'
  detail: string; // 'Normal Goal' | 'Yellow Card' | 'Red Card' | etc.
  comments: string | null;
}

export interface ApiFootballStanding {
  rank: number;
  team: { id: number; name: string; logo: string };
  points: number;
  goalsDiff: number;
  group: string;
  form: string;
  status: string;
  description: string | null;
  all: { played: number; win: number; draw: number; lose: number; goals: { for: number; against: number } };
}

export interface ApiFootballFixtureStatistic {
  team: { id: number; name: string };
  statistics: Array<{ type: string; value: string | number | null }>;
}

export interface ApiFootballFixturePlayer {
  team: { id: number; name: string };
  players: Array<{
    player: { id: number; name: string; photo: string };
    statistics: Array<{
      games: { minutes: number | null; rating: string | null; substitute: boolean };
      goals: { total: number | null; assists: number | null };
    }>;
  }>;
}

export interface ApiFootballPlayer {
  player: {
    id: number;
    name: string;
    firstname: string;
    lastname: string;
    age: number;
    birth: { date: string; place: string; country: string };
    nationality: string;
    height: string;
    weight: string;
    photo: string;
  };
  statistics: ApiFootballPlayerStats[];
}

export interface ApiFootballPlayerStats {
  team: { id: number; name: string };
  league: { id: number; name: string; season: number };
  games: { position: string; rating: string | null; captain: boolean };
  goals: { total: number | null; assists: number | null };
}

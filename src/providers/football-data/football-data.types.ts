// Raw football-data.org v4 response shapes

export interface FDTeamRef {
  id: number;
  name: string;
  shortName: string;
  tla: string;
  crest: string;
}

export interface FDMatch {
  id: number;
  utcDate: string; // ISO 8601
  status:
    | 'SCHEDULED'
    | 'TIMED'
    | 'IN_PLAY'
    | 'PAUSED'
    | 'HALFTIME'
    | 'FINISHED'
    | 'POSTPONED'
    | 'CANCELLED'
    | 'AWARDED'
    | 'SUSPENDED';
  matchday: number | null;
  stage: string;
  competition: { id: number; name: string; code: string };
  season: {
    id: number;
    startDate: string;
    endDate: string;
    currentMatchday: number;
  };
  homeTeam: FDTeamRef;
  awayTeam: FDTeamRef;
  score: {
    winner: 'HOME_TEAM' | 'AWAY_TEAM' | 'DRAW' | null;
    fullTime: { home: number | null; away: number | null };
    halfTime: { home: number | null; away: number | null };
  };
  referees: Array<{ id: number; name: string; type: string }>;
}

export interface FDStandingEntry {
  position: number;
  team: { id: number; name: string; crest: string };
  playedGames: number;
  won: number;
  draw: number;
  lost: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  form: string | null;
}

export interface FDCompetitionStandings {
  competition: { id: number; name: string; code: string };
  season: { id: number; startDate: string; endDate: string; currentMatchday: number };
  standings: Array<{
    stage: string;
    type: 'TOTAL' | 'HOME' | 'AWAY';
    table: FDStandingEntry[];
  }>;
}

export interface FDPerson {
  id: number;
  name: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  nationality: string;
  position: string | null;
  shirtNumber: number | null;
  currentTeam: {
    id: number;
    name: string;
    joined: string | null;
    contract: { start: string | null; until: string | null } | null;
  } | null;
}

export interface FDSquadMember {
  id: number;
  name: string;
  position: string | null;
  dateOfBirth: string;
  nationality: string;
  shirtNumber: number | null;
}

export interface FDTeam {
  id: number;
  name: string;
  shortName: string;
  tla: string;
  crest: string;
  address: string | null;
  website: string | null;
  founded: number | null;
  clubColors: string | null;
  venue: string | null;
  coach: {
    id: number;
    name: string;
    dateOfBirth: string;
    nationality: string;
  } | null;
  runningCompetitions: Array<{ id: number; name: string; code: string }>;
  squad: FDSquadMember[];
}

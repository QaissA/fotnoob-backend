export interface H2HTeamAggregateDto {
  id: number;
  name: string;
  wins: number;
  draws: number;
  losses: number;
}

export interface H2HMatchDto {
  id: number;
  utcDate: string;
  status: string;
  homeTeam: { id: number; name: string; crest: string };
  awayTeam: { id: number; name: string; crest: string };
  score: {
    fullTime: { home: number | null; away: number | null };
    halfTime: { home: number | null; away: number | null };
  };
}

export interface Head2HeadDto {
  numberOfMatches: number;
  totalGoals: number;
  home: H2HTeamAggregateDto;
  away: H2HTeamAggregateDto;
  recentMatches: H2HMatchDto[];
}

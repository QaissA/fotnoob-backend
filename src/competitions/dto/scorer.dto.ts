export interface ScorerDto {
  playerId: number;
  playerName: string;
  nationality: string;
  position: string | null;
  teamId: number;
  teamName: string;
  teamCrest: string;
  goals: number;
  assists: number | null;
  penalties: number | null;
  playedMatches: number;
}

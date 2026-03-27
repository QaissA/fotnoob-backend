export interface CompetitionDetailDto {
  id: number;
  name: string;
  code: string;
  type: string;
  emblem: string | null;
  country: string;
  currentMatchday: number | null;
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { type AxiosInstance } from 'axios';
import type { AppConfig } from '../../config/configuration.js';
import type {
  FDMatch,
  FDStandingEntry,
  FDCompetitionStandings,
  FDPerson,
  FDTeam,
} from './football-data.types.js';
import type { LeagueCode } from './league-codes.js';

@Injectable()
export class FootballDataService {
  private readonly logger = new Logger(FootballDataService.name);
  private readonly http: AxiosInstance;

  constructor(private readonly config: ConfigService<AppConfig>) {
    this.http = axios.create({
      baseURL: 'https://api.football-data.org/v4',
      headers: {
        'X-Auth-Token': this.config.get('FOOTBALL_DATA_API_KEY', { infer: true }),
      },
      timeout: 10_000,
    });

    // Rate limit logging — free tier = 10 req/min
    this.http.interceptors.response.use((response) => {
      const remaining = response.headers['x-requests-available-minute'];
      if (remaining !== undefined) {
        this.logger.debug(`[football-data] ${remaining} requests remaining this minute`);
        if (Number(remaining) <= 2) {
          this.logger.warn('[football-data] Rate limit nearly hit — slow down requests');
        }
      }
      return response;
    });
  }

  async getMatchesByDate(date: string): Promise<FDMatch[]> {
    const { data } = await this.http.get<{ matches: FDMatch[] }>('/matches', {
      params: { date },
    });
    this.logger.debug(`Fetched ${data.matches.length} matches for ${date}`);
    return data.matches;
  }

  async getMatch(matchId: number): Promise<FDMatch> {
    const { data } = await this.http.get<FDMatch>(`/matches/${matchId}`);
    return data;
  }

  async getLiveMatches(): Promise<FDMatch[]> {
    const { data } = await this.http.get<{ matches: FDMatch[] }>('/matches', {
      params: { status: 'IN_PLAY,PAUSED,HALFTIME' },
    });
    return data.matches;
  }

  async getCompetitionMatches(
    leagueCode: LeagueCode,
    params?: { matchday?: number; status?: string; dateFrom?: string; dateTo?: string },
  ): Promise<FDMatch[]> {
    const { data } = await this.http.get<{ matches: FDMatch[] }>(
      `/competitions/${leagueCode}/matches`,
      { params },
    );
    return data.matches;
  }

  async getStandings(leagueCode: LeagueCode): Promise<FDStandingEntry[]> {
    const { data } = await this.http.get<FDCompetitionStandings>(
      `/competitions/${leagueCode}/standings`,
    );
    const total = data.standings.find((s) => s.type === 'TOTAL');
    return total?.table ?? [];
  }

  async getPerson(personId: number): Promise<FDPerson> {
    const { data } = await this.http.get<FDPerson>(`/persons/${personId}`);
    return data;
  }

  async getTeam(teamId: number): Promise<FDTeam> {
    const { data } = await this.http.get<FDTeam>(`/teams/${teamId}`);
    return data;
  }

  async getCompetitionTeams(leagueCode: LeagueCode): Promise<FDTeam[]> {
    const { data } = await this.http.get<{ teams: FDTeam[] }>(
      `/competitions/${leagueCode}/teams`,
    );
    return data.teams;
  }
}

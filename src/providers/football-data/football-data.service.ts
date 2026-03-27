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
  FDArea,
  FDCompetition,
  FDScorer,
  FDHead2Head,
  FDMatchFilters,
  FDTeamMatchFilters,
  FDPersonMatchFilters,
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

  async getArea(areaId: number): Promise<FDArea> {
    const { data } = await this.http.get<FDArea>(`/areas/${areaId}`);
    return data;
  }

  async getAreas(): Promise<FDArea[]> {
    const { data } = await this.http.get<{ areas: FDArea[] }>('/areas');
    this.logger.debug(`Fetched ${data.areas.length} areas`);
    return data.areas;
  }

  async getCompetition(leagueCode: LeagueCode): Promise<FDCompetition> {
    const { data } = await this.http.get<FDCompetition>(`/competitions/${leagueCode}`);
    return data;
  }

  async getCompetitions(params?: { areas?: string }): Promise<FDCompetition[]> {
    const { data } = await this.http.get<{ competitions: FDCompetition[] }>('/competitions', { params });
    this.logger.debug(`Fetched ${data.competitions.length} competitions`);
    return data.competitions;
  }

  async getCompetitionScorers(
    leagueCode: LeagueCode,
    params?: { limit?: number; season?: number },
  ): Promise<FDScorer[]> {
    const { data } = await this.http.get<{ scorers: FDScorer[] }>(
      `/competitions/${leagueCode}/scorers`,
      { params },
    );
    return data.scorers;
  }

  async getTeams(params?: { limit?: number; offset?: number }): Promise<FDTeam[]> {
    const { data } = await this.http.get<{ teams: FDTeam[] }>('/teams', { params });
    this.logger.debug(`Fetched ${data.teams.length} teams`);
    return data.teams;
  }

  async getTeamMatches(teamId: number, params?: FDTeamMatchFilters): Promise<FDMatch[]> {
    const { data } = await this.http.get<{ matches: FDMatch[] }>(
      `/teams/${teamId}/matches`,
      { params },
    );
    return data.matches;
  }

  async getPersonMatches(personId: number, params?: FDPersonMatchFilters): Promise<FDMatch[]> {
    const { data } = await this.http.get<{ matches: FDMatch[] }>(
      `/persons/${personId}/matches`,
      { params },
    );
    return data.matches;
  }

  async getMatches(params: FDMatchFilters): Promise<FDMatch[]> {
    const { data } = await this.http.get<{ matches: FDMatch[] }>('/matches', { params });
    this.logger.debug(`Fetched ${data.matches.length} matches`);
    return data.matches;
  }

  async getHead2Head(
    matchId: number,
    params?: { limit?: number; dateFrom?: string; dateTo?: string; competitions?: string },
  ): Promise<FDHead2Head> {
    const { data } = await this.http.get<FDHead2Head>(`/matches/${matchId}/head2head`, { params });
    return data;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { type AxiosInstance } from 'axios';
import type { AppConfig } from '../../config/configuration.js';
import type {
  ApiFootballFixture,
  ApiFootballEvent,
  ApiFootballStanding,
  ApiFootballPlayer,
  ApiFootballFixtureStatistic,
  ApiFootballFixturePlayer,
} from './football-data.types.js';

interface ApiResponse<T> {
  response: T;
  results: number;
  errors: string[] | Record<string, string>;
}

@Injectable()
export class FootballDataService {
  private readonly logger = new Logger(FootballDataService.name);
  private readonly http: AxiosInstance;

  constructor(private readonly config: ConfigService<AppConfig>) {
    this.http = axios.create({
      baseURL: 'https://api-football-v1.p.rapidapi.com/v3',
      headers: {
        'X-RapidAPI-Key': this.config.get('RAPIDAPI_KEY', { infer: true }),
        'X-RapidAPI-Host': this.config.get('RAPIDAPI_HOST', { infer: true }),
      },
      timeout: 10_000,
    });
  }

  async getFixturesByDate(date: string): Promise<ApiFootballFixture[]> {
    const { data } = await this.http.get<ApiResponse<ApiFootballFixture[]>>(
      '/fixtures',
      { params: { date } },
    );
    this.logger.debug(`Fetched ${data.results} fixtures for ${date}`);
    return data.response;
  }

  async getFixture(fixtureId: number): Promise<ApiFootballFixture | null> {
    const { data } = await this.http.get<ApiResponse<ApiFootballFixture[]>>(
      '/fixtures',
      { params: { id: fixtureId } },
    );
    return data.response[0] ?? null;
  }

  async getFixtureEvents(fixtureId: number): Promise<ApiFootballEvent[]> {
    const { data } = await this.http.get<ApiResponse<ApiFootballEvent[]>>(
      '/fixtures/events',
      { params: { fixture: fixtureId } },
    );
    return data.response;
  }

  async getStandings(leagueId: number, season: number): Promise<ApiFootballStanding[][]> {
    const { data } = await this.http.get<ApiResponse<Array<{ league: { standings: ApiFootballStanding[][] } }>>>(
      '/standings',
      { params: { league: leagueId, season } },
    );
    return data.response[0]?.league.standings ?? [];
  }

  async getPlayer(playerId: number, season: number): Promise<ApiFootballPlayer | null> {
    const { data } = await this.http.get<ApiResponse<ApiFootballPlayer[]>>(
      '/players',
      { params: { id: playerId, season } },
    );
    return data.response[0] ?? null;
  }

  async getFixtureStatistics(fixtureId: number): Promise<ApiFootballFixtureStatistic[]> {
    const { data } = await this.http.get<ApiResponse<ApiFootballFixtureStatistic[]>>(
      '/fixtures/statistics',
      { params: { fixture: fixtureId } },
    );
    return data.response;
  }

  async getFixturePlayers(fixtureId: number): Promise<ApiFootballFixturePlayer[]> {
    const { data } = await this.http.get<ApiResponse<ApiFootballFixturePlayer[]>>(
      '/fixtures/players',
      { params: { fixture: fixtureId } },
    );
    return data.response;
  }

  async getLiveFixtures(leagueId?: number): Promise<ApiFootballFixture[]> {
    const params: Record<string, unknown> = { live: 'all' };
    if (leagueId) params['league'] = leagueId;
    const { data } = await this.http.get<ApiResponse<ApiFootballFixture[]>>(
      '/fixtures',
      { params },
    );
    return data.response;
  }
}

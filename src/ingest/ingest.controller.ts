import { Controller, Post, Get, Param, Query, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiParam, ApiResponse } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { IngestService } from './ingest.service.js';
import { FootballDataService } from '../providers/football-data/football-data.service.js';

@ApiTags('Ingest')
@Public()
@Controller('ingest')
export class IngestController {
  constructor(
    private readonly ingest: IngestService,
    private readonly footballData: FootballDataService,
  ) {}

  @Post('fixtures')
  @ApiOperation({ summary: 'Trigger fixture ingest for a given date (defaults to today)' })
  @ApiQuery({ name: 'date', required: false, example: '2025-03-24', description: 'YYYY-MM-DD' })
  @ApiResponse({ status: 201, schema: { example: { ingested: '2025-03-24' } } })
  async ingestFixtures(@Query('date') date?: string): Promise<{ ingested: string }> {
    const target = date ?? new Date().toISOString().slice(0, 10);
    await this.ingest.ingestFixturesForDate(target);
    return { ingested: target };
  }

  @Post('standings')
  @ApiOperation({ summary: 'Trigger standings sync for all active leagues' })
  @ApiResponse({ status: 201, schema: { example: { ok: true } } })
  async ingestStandings(): Promise<{ ok: boolean }> {
    await this.ingest.syncStandings();
    return { ok: true };
  }

  @Post('competitions')
  @ApiOperation({ summary: 'Trigger competition metadata sync (enriches country, logo)' })
  @ApiResponse({ status: 201, schema: { example: { ok: true } } })
  async ingestCompetitions(): Promise<{ ok: boolean }> {
    await this.ingest.syncCompetitions();
    return { ok: true };
  }

  @Post('scorers')
  @ApiOperation({ summary: 'Trigger top scorers sync for all active leagues' })
  @ApiResponse({ status: 201, schema: { example: { ok: true } } })
  async ingestScorers(): Promise<{ ok: boolean }> {
    await this.ingest.syncTopScorers();
    return { ok: true };
  }

  @Post('team-matches')
  @ApiOperation({ summary: 'Backfill matches for a specific team' })
  @ApiQuery({ name: 'teamId', required: true, description: 'football-data.org team ID' })
  @ApiQuery({ name: 'season', required: false, description: 'Season year (e.g. 2024)' })
  @ApiResponse({ status: 201, schema: { example: { ingested: 38, teamId: 57 } } })
  async ingestTeamMatches(
    @Query('teamId') teamIdStr: string,
    @Query('season') seasonStr?: string,
  ): Promise<{ ingested: number; teamId: number }> {
    const teamId = parseInt(teamIdStr, 10);
    if (isNaN(teamId)) throw new BadRequestException('teamId must be a number');
    const season = seasonStr ? parseInt(seasonStr, 10) : undefined;
    const ingested = await this.ingest.syncTeamMatches(teamId, season ? { season } : undefined);
    return { ingested, teamId };
  }

  @Get('competitions')
  @ApiOperation({ summary: 'List all available competitions from football-data.org' })
  @ApiResponse({ status: 200, description: 'Raw list of competitions from external API' })
  async listCompetitions() {
    return this.footballData.getCompetitions();
  }

  @Get('competitions/:code')
  @ApiOperation({ summary: 'Fetch a single competition from football-data.org and save to DB' })
  @ApiParam({ name: 'code', example: 'PL', description: 'Competition code (e.g. PL, CL, BL1)' })
  @ApiResponse({ status: 200, schema: { example: { externalId: 'PL', name: 'Premier League', country: 'England', logoUrl: 'https://...' } } })
  async getAndIngestCompetition(@Param('code') code: string) {
    return this.ingest.ingestCompetition(code.toUpperCase());
  }

  @Post('competitions/:code/standings')
  @ApiOperation({ summary: 'Ingest standings for a competition from football-data.org' })
  @ApiParam({ name: 'code', example: 'PL', description: 'Competition code' })
  @ApiQuery({ name: 'matchday', required: false, description: 'Filter by matchday' })
  @ApiQuery({ name: 'season', required: false, description: 'Season year (e.g. 2024)' })
  @ApiQuery({ name: 'date', required: false, description: 'YYYY-MM-DD' })
  @ApiResponse({ status: 201, schema: { example: { ok: true } } })
  async ingestStandings(
    @Param('code') code: string,
    @Query('matchday') matchday?: string,
    @Query('season') season?: string,
    @Query('date') date?: string,
  ): Promise<{ ok: boolean }> {
    await this.ingest.ingestStandingsForCompetition(code.toUpperCase(), {
      matchday: matchday ? parseInt(matchday, 10) : undefined,
      season: season ? parseInt(season, 10) : undefined,
      date,
    });
    return { ok: true };
  }

  @Post('competitions/:code/matches')
  @ApiOperation({ summary: 'Ingest matches for a competition from football-data.org' })
  @ApiParam({ name: 'code', example: 'PL', description: 'Competition code' })
  @ApiQuery({ name: 'matchday', required: false, description: 'Filter by matchday' })
  @ApiQuery({ name: 'status', required: false, description: 'Match status (e.g. SCHEDULED, FINISHED)' })
  @ApiQuery({ name: 'dateFrom', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'dateTo', required: false, description: 'YYYY-MM-DD' })
  @ApiResponse({ status: 201, schema: { example: { ok: true } } })
  async ingestCompetitionMatches(
    @Param('code') code: string,
    @Query('matchday') matchday?: string,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ): Promise<{ ok: boolean }> {
    await this.ingest.ingestCompetitionMatches(code.toUpperCase(), {
      matchday: matchday ? parseInt(matchday, 10) : undefined,
      status,
      dateFrom,
      dateTo,
    });
    return { ok: true };
  }
}

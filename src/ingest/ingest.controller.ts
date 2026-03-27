import { Controller, Post, Query, ParseIntPipe, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { IngestService } from './ingest.service.js';

@ApiTags('Ingest')
@Public()
@Controller('ingest')
export class IngestController {
  constructor(private readonly ingest: IngestService) {}

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
}

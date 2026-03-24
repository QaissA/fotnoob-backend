import { Controller, Post, Query } from '@nestjs/common';
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
}

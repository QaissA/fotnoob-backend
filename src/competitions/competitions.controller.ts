import { Controller, Get, Param, Query, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { CompetitionsService } from './competitions.service.js';

@ApiTags('Competitions')
@Public()
@Controller('competitions')
export class CompetitionsController {
  constructor(private readonly competitionsService: CompetitionsService) {}

  @Get(':code')
  @ApiOperation({ summary: 'Get competition details by league code (e.g. PL, CL, PD)' })
  @ApiParam({ name: 'code', example: 'PL' })
  @ApiResponse({ status: 200 })
  getCompetition(@Param('code') code: string) {
    return this.competitionsService.getCompetition(code.toUpperCase());
  }

  @Get(':code/scorers')
  @ApiOperation({ summary: 'Get top scorers for a competition' })
  @ApiParam({ name: 'code', example: 'PL' })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiQuery({ name: 'season', required: false, example: 2024, description: '4-digit year' })
  @ApiResponse({ status: 200 })
  getTopScorers(
    @Param('code') code: string,
    @Query('limit') limit?: string,
    @Query('season') season?: string,
  ) {
    const parsedLimit = limit ? Math.min(parseInt(limit, 10) || 10, 50) : 10;
    const parsedSeason = season ? parseInt(season, 10) : undefined;
    return this.competitionsService.getTopScorers(code.toUpperCase(), parsedLimit, parsedSeason);
  }

  @Get(':code/head2head/:matchId')
  @ApiOperation({ summary: 'Get head-to-head record for the two teams in a match' })
  @ApiParam({ name: 'code', example: 'PL' })
  @ApiParam({ name: 'matchId', example: 123456 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiResponse({ status: 200 })
  getHead2Head(
    @Param('matchId', ParseIntPipe) matchId: number,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) || 10 : 10;
    return this.competitionsService.getHead2Head(matchId, parsedLimit);
  }
}

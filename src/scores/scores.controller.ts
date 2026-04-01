import {
  Controller,
  Get,
  Param,
  Query,
  UsePipes,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ScoresService } from './scores.service.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { Public } from '../common/decorators/public.decorator.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import {
  GetMatchesQuerySchema,
  GetMatchesQueryDto,
  MatchesByLeagueDto,
  MatchResponseDto,
} from './dto/get-matches.dto.js';
import { MatchEventResponseDto } from './dto/match-event.dto.js';

@ApiTags('Scores')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('scores')
export class ScoresController {
  constructor(private readonly scores: ScoresService) {}

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('matches')
  @UsePipes(new ZodValidationPipe(GetMatchesQuerySchema))
  @ApiOperation({ summary: 'Get matches grouped by league for a given date' })
  @ApiQuery({ type: GetMatchesQueryDto })
  @ApiResponse({ status: 200, type: [MatchesByLeagueDto] })
  getMatches(@Query() query: { date: string }): Promise<MatchesByLeagueDto[]> {
    return this.scores.getMatchesByDate(query.date);
  }

  @Public()
  @Get('matches/:id')
  @ApiOperation({ summary: 'Get a single match by ID' })
  @ApiParam({ name: 'id', description: 'Internal match ID' })
  @ApiResponse({ status: 200, type: MatchResponseDto })
  @ApiResponse({ status: 404, description: 'Match not found' })
  getMatch(@Param('id') id: string): Promise<MatchResponseDto> {
    return this.scores.getMatchById(id);
  }

  @Public()
  @Get('matches/:id/events')
  @ApiOperation({ summary: 'Get timeline events for a match' })
  @ApiParam({ name: 'id', description: 'Internal match ID' })
  @ApiResponse({ status: 200, type: [MatchEventResponseDto] })
  getMatchEvents(
    @Param('id') id: string,
  ): Promise<MatchEventResponseDto[]> {
    return this.scores.getMatchEvents(id);
  }

  @Public()
  @Get('competitions/:code/standings')
  @ApiOperation({ summary: 'Get standings for a competition — checks DB first, falls back to external API' })
  @ApiParam({ name: 'code', example: 'PL', description: 'Competition code (e.g. PL, CL, BL1)' })
  @ApiQuery({ name: 'matchday', required: false, description: 'Matchday number' })
  @ApiQuery({ name: 'season', required: false, description: 'Season year (e.g. 2024)' })
  @ApiQuery({ name: 'date', required: false, description: 'YYYY-MM-DD' })
  getStandings(
    @Param('code') code: string,
    @Query('matchday') matchday?: string,
    @Query('season') season?: string,
    @Query('date') date?: string,
  ) {
    return this.scores.getStandingsByCompetition(code.toUpperCase(), {
      matchday: matchday ? parseInt(matchday, 10) : undefined,
      season: season ? parseInt(season, 10) : undefined,
      date,
    });
  }

  @Public()
  @Get('competitions/:code/matches')
  @ApiOperation({ summary: 'Get all matches for a competition — checks DB first, falls back to external API' })
  @ApiParam({ name: 'code', example: 'PL', description: 'Competition code (e.g. PL, CL, BL1)' })
  @ApiQuery({ name: 'matchday', required: false, description: 'Matchday number' })
  @ApiQuery({ name: 'status', required: false, description: 'Match status (e.g. SCHEDULED, FINISHED)' })
  @ApiQuery({ name: 'dateFrom', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'dateTo', required: false, description: 'YYYY-MM-DD' })
  getCompetitionMatches(
    @Param('code') code: string,
    @Query('matchday') matchday?: string,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.scores.getMatchesByCompetition(code.toUpperCase(), {
      matchday: matchday ? parseInt(matchday, 10) : undefined,
      status,
      dateFrom,
      dateTo,
    });
  }
}

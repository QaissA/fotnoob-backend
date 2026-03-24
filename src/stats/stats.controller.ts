import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { Public } from '../common/decorators/public.decorator.js';
import { StatsService } from './stats.service.js';
import {
  MatchStatsResponseDto,
  PlayerRatingDto,
  StandingRowDto,
} from './dto/match-stats.dto.js';

@ApiTags('Stats')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Public()
  @Get('matches/:id')
  @ApiOperation({ summary: 'Get detailed stats for a match' })
  @ApiParam({ name: 'id', description: 'Internal match ID' })
  @ApiResponse({ status: 200, type: MatchStatsResponseDto })
  getMatchStats(@Param('id') id: string): Promise<MatchStatsResponseDto> {
    return this.stats.getMatchStats(id);
  }

  @Public()
  @Get('matches/:id/ratings')
  @ApiOperation({ summary: 'Get player ratings for a match' })
  @ApiParam({ name: 'id', description: 'Internal match ID' })
  @ApiResponse({ status: 200, type: [PlayerRatingDto] })
  getPlayerRatings(@Param('id') id: string): Promise<PlayerRatingDto[]> {
    return this.stats.getPlayerRatings(id);
  }

  @Public()
  @Get('leagues/:id/table')
  @ApiOperation({ summary: 'Get current league standings' })
  @ApiParam({ name: 'id', description: 'Internal league ID' })
  @ApiResponse({ status: 200, type: [StandingRowDto] })
  getStandings(@Param('id') id: string): Promise<StandingRowDto[]> {
    return this.stats.getLeagueStandings(id);
  }

  @Public()
  @Get('teams/:id/form')
  @ApiOperation({ summary: 'Get last 5 results for a team (W/D/L)' })
  @ApiParam({ name: 'id', description: 'Internal team ID' })
  @ApiResponse({ status: 200, schema: { example: ['W', 'W', 'D', 'L', 'W'] } })
  getTeamForm(@Param('id') id: string): Promise<string[]> {
    return this.stats.getTeamForm(id);
  }
}

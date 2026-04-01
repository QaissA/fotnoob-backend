import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { TeamsService } from './teams.service.js';
import { TeamDetailDto, TeamSummaryDto } from './dto/team.dto.js';
import type { MatchResponseDto } from '../scores/dto/get-matches.dto.js';

@ApiTags('Teams')
@Public()
@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  @ApiOperation({ summary: 'List teams — checks DB first, falls back to external API' })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiQuery({ name: 'offset', required: false, example: 0 })
  @ApiResponse({ status: 200, type: [TeamSummaryDto] })
  listTeams(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<TeamSummaryDto[]> {
    const parsedLimit = Math.min(limit ? parseInt(limit, 10) || 20 : 20, 50);
    const parsedOffset = offset ? parseInt(offset, 10) || 0 : 0;
    return this.teams.listTeams(parsedLimit, parsedOffset);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a team by external ID — checks DB first, falls back to external API' })
  @ApiParam({ name: 'id', description: 'football-data.org team ID', example: 57 })
  @ApiResponse({ status: 200, type: TeamDetailDto })
  @ApiResponse({ status: 404, description: 'Team not found' })
  getTeam(@Param('id') id: string): Promise<TeamDetailDto> {
    return this.teams.getTeamById(id);
  }

  @Get(':id/matches')
  @ApiOperation({ summary: 'Get matches for a team — checks DB first, falls back to external API' })
  @ApiParam({ name: 'id', description: 'football-data.org team ID', example: 57 })
  @ApiQuery({ name: 'dateFrom', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'dateTo', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'season', required: false, description: 'Season year (e.g. 2024)' })
  @ApiQuery({ name: 'status', required: false, description: 'Match status (e.g. SCHEDULED, FINISHED)' })
  @ApiQuery({ name: 'venue', required: false, description: 'HOME or AWAY' })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiResponse({ status: 200, type: [Object] })
  getTeamMatches(
    @Param('id') id: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('season') season?: string,
    @Query('status') status?: string,
    @Query('venue') venue?: string,
    @Query('limit') limit?: string,
  ): Promise<MatchResponseDto[]> {
    return this.teams.getTeamMatches(id, {
      dateFrom,
      dateTo,
      season: season ? parseInt(season, 10) : undefined,
      status,
      venue: venue as 'HOME' | 'AWAY' | undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }
}

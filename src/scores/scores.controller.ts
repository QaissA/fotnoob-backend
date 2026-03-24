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
}

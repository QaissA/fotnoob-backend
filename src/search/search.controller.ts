import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { Public } from '../common/decorators/public.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { SearchService } from './search.service.js';
import { SearchQuerySchema, type SearchQuery, SearchResponseDto } from './dto/search.dto.js';

@ApiTags('Search')
@UseGuards(JwtAuthGuard)
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get()
  @ApiOperation({ summary: 'Search for teams, players and leagues' })
  @ApiQuery({ name: 'q', description: 'Search term', example: 'Arsenal' })
  @ApiQuery({
    name: 'type',
    enum: ['all', 'players', 'teams', 'leagues'],
    required: false,
  })
  @ApiResponse({ status: 200, type: SearchResponseDto })
  search(
    @Query(new ZodValidationPipe(SearchQuerySchema)) query: SearchQuery,
  ): Promise<SearchResponseDto> {
    return this.search.search(query);
  }
}

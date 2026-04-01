import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { PersonsService } from './persons.service.js';
import { PersonDto } from './dto/person.dto.js';
import type { MatchResponseDto } from '../scores/dto/get-matches.dto.js';

@ApiTags('Persons')
@Public()
@Controller('persons')
export class PersonsController {
  constructor(private readonly persons: PersonsService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Get a person by external ID — checks DB first, falls back to external API' })
  @ApiParam({ name: 'id', description: 'football-data.org person ID', example: 44 })
  @ApiResponse({ status: 200, type: PersonDto })
  @ApiResponse({ status: 404, description: 'Person not found' })
  getPerson(@Param('id') id: string): Promise<PersonDto> {
    return this.persons.getPersonById(id);
  }

  @Get(':id/matches')
  @ApiOperation({ summary: 'Get matches for a person — checks DB first, falls back to external API' })
  @ApiParam({ name: 'id', description: 'football-data.org person ID', example: 44 })
  @ApiQuery({ name: 'dateFrom', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'dateTo', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'competitions', required: false, description: 'Comma-separated competition codes' })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiQuery({ name: 'offset', required: false, example: 0 })
  @ApiResponse({ status: 200, type: [Object] })
  getPersonMatches(
    @Param('id') id: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('status') status?: string,
    @Query('competitions') competitions?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<MatchResponseDto[]> {
    return this.persons.getPersonMatches(id, {
      dateFrom,
      dateTo,
      status,
      competitions,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }
}

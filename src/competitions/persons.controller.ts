import { Controller, Get, Param, Query, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { CompetitionsService } from './competitions.service.js';

@ApiTags('Persons')
@Public()
@Controller('persons')
export class PersonsController {
  constructor(private readonly competitionsService: CompetitionsService) {}

  @Get(':personId/matches')
  @ApiOperation({ summary: 'Get matches for a person (player or manager)' })
  @ApiParam({ name: 'personId', example: 44 })
  @ApiQuery({ name: 'dateFrom', required: false, example: '2024-08-01', description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'dateTo', required: false, example: '2025-05-31', description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiResponse({ status: 200 })
  getPersonMatches(
    @Param('personId', ParseIntPipe) personId: number,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) || 10 : undefined;
    return this.competitionsService.getPersonMatches(personId, { dateFrom, dateTo, limit: parsedLimit });
  }
}

import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { Public } from '../common/decorators/public.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { NewsService } from './news.service.js';
import {
  GetNewsQuerySchema,
  ArticleDto,
  PaginatedArticlesDto,
} from './dto/news.dto.js';

@ApiTags('News')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('news')
export class NewsController {
  constructor(private readonly news: NewsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Get paginated articles, optionally filtered by team or league' })
  @ApiQuery({ name: 'teamId', required: false })
  @ApiQuery({ name: 'leagueId', required: false })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiResponse({ status: 200, type: PaginatedArticlesDto })
  getArticles(
    @Query(new ZodValidationPipe(GetNewsQuerySchema)) query: {
      teamId?: string;
      leagueId?: string;
      page: number;
      limit: number;
    },
  ): Promise<PaginatedArticlesDto> {
    return this.news.getArticles(query);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get a single article by ID' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: ArticleDto })
  @ApiResponse({ status: 404, description: 'Article not found' })
  getArticle(@Param('id') id: string): Promise<ArticleDto> {
    return this.news.getArticleById(id);
  }
}

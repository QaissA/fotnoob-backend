import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import type { GetNewsQuery, PaginatedArticlesDto, ArticleDto } from './dto/news.dto.js';

@Injectable()
export class NewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async getArticles(query: GetNewsQuery): Promise<PaginatedArticlesDto> {
    const { teamId, leagueId, page, limit } = query;
    const skip = (page - 1) * limit;

    const cacheKey = teamId
      ? `news:${teamId}:${page}`
      : leagueId
        ? `news:league:${leagueId}:${page}`
        : `news:all:${page}`;

    return this.redis.cachedFetch(cacheKey, 900, async () => {
      const where = {
        ...(teamId ? { teamId } : {}),
        ...(leagueId ? { leagueId } : {}),
      };

      const [items, total] = await Promise.all([
        this.prisma.reader.article.findMany({
          where,
          orderBy: [{ publishedAt: 'desc' }],
          skip,
          take: limit,
        }),
        this.prisma.reader.article.count({ where }),
      ]);

      return {
        items: items.map(this.toDto),
        total,
        page,
        limit,
      };
    });
  }

  async getArticleById(id: string): Promise<ArticleDto> {
    const article = await this.prisma.reader.article.findUnique({
      where: { id },
    });
    if (!article) throw new NotFoundException(`Article ${id} not found`);
    return this.toDto(article);
  }

  private toDto(a: {
    id: string;
    title: string;
    sourceUrl: string;
    imageUrl: string | null;
    aiSummary: string | null;
    teamId: string | null;
    leagueId: string | null;
    publishedAt: Date;
    status: string;
  }): ArticleDto {
    return {
      id: a.id,
      title: a.title,
      sourceUrl: a.sourceUrl,
      imageUrl: a.imageUrl,
      aiSummary: a.aiSummary,
      teamId: a.teamId,
      leagueId: a.leagueId,
      publishedAt: a.publishedAt.toISOString(),
      status: a.status,
    };
  }
}

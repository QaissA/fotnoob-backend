import { z } from 'zod';
import { ApiProperty } from '@nestjs/swagger';

export const GetNewsQuerySchema = z.object({
  teamId: z.string().optional(),
  leagueId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type GetNewsQuery = z.infer<typeof GetNewsQuerySchema>;

export class ArticleDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() sourceUrl!: string;
  @ApiProperty({ nullable: true }) imageUrl!: string | null;
  @ApiProperty({ nullable: true }) aiSummary!: string | null;
  @ApiProperty({ nullable: true }) teamId!: string | null;
  @ApiProperty({ nullable: true }) leagueId!: string | null;
  @ApiProperty() publishedAt!: string;
  @ApiProperty() status!: string;
}

export class PaginatedArticlesDto {
  @ApiProperty({ type: [ArticleDto] }) items!: ArticleDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}

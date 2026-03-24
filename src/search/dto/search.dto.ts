import { z } from 'zod';
import { ApiProperty } from '@nestjs/swagger';

export const SearchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  type: z.enum(['all', 'players', 'teams', 'leagues']).default('all'),
});

export type SearchQuery = z.infer<typeof SearchQuerySchema>;

export class SearchResultItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() type!: 'player' | 'team' | 'league';
  @ApiProperty({ nullable: true }) subtitle!: string | null;
  @ApiProperty({ nullable: true }) imageUrl!: string | null;
}

export class SearchResponseDto {
  @ApiProperty({ type: [SearchResultItemDto] }) results!: SearchResultItemDto[];
  @ApiProperty() total!: number;
}

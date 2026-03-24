import { z } from 'zod';
import { ApiProperty } from '@nestjs/swagger';

export const UpdateFavouritesSchema = z.object({
  teamIds: z.array(z.string()).optional(),
  leagueIds: z.array(z.string()).optional(),
  playerIds: z.array(z.string()).optional(),
});

export type UpdateFavouritesDto = z.infer<typeof UpdateFavouritesSchema>;

export class FavouritesResponseDto {
  @ApiProperty({ type: [String] }) teamIds!: string[];
  @ApiProperty({ type: [String] }) leagueIds!: string[];
  @ApiProperty({ type: [String] }) playerIds!: string[];
}

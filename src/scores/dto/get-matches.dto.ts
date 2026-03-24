import { z } from 'zod';
import { ApiProperty } from '@nestjs/swagger';

export const GetMatchesQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .default(() => new Date().toISOString().split('T')[0]!),
});

export type GetMatchesQuery = z.infer<typeof GetMatchesQuerySchema>;

export class GetMatchesQueryDto {
  @ApiProperty({ example: '2024-12-01', description: 'Match date (YYYY-MM-DD)' })
  date!: string;
}

export class TeamSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() shortName!: string;
  @ApiProperty({ nullable: true }) logoUrl!: string | null;
}

export class MatchResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() homeScore!: number;
  @ApiProperty() awayScore!: number;
  @ApiProperty() status!: string;
  @ApiProperty({ nullable: true }) minute!: number | null;
  @ApiProperty() kickoffTime!: string;
  @ApiProperty({ nullable: true }) venue!: string | null;
  @ApiProperty({ nullable: true }) round!: string | null;
  @ApiProperty({ type: TeamSummaryDto }) homeTeam!: TeamSummaryDto;
  @ApiProperty({ type: TeamSummaryDto }) awayTeam!: TeamSummaryDto;
}

export class MatchesByLeagueDto {
  @ApiProperty() leagueId!: string;
  @ApiProperty() leagueName!: string;
  @ApiProperty({ nullable: true }) logoUrl!: string | null;
  @ApiProperty({ type: [MatchResponseDto] }) matches!: MatchResponseDto[];
}

import { ApiProperty } from '@nestjs/swagger';
import type { EventType } from '@prisma/client';

export class MatchEventResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() matchId!: string;
  @ApiProperty() type!: EventType;
  @ApiProperty() minute!: number;
  @ApiProperty({ nullable: true }) addedTime!: number | null;
  @ApiProperty() teamId!: string;
  @ApiProperty() playerId!: string;
  @ApiProperty({ nullable: true }) assistPlayerId!: string | null;
  @ApiProperty({ nullable: true }) detail!: string | null;
  @ApiProperty({ nullable: true }) homeScoreAfter!: number | null;
  @ApiProperty({ nullable: true }) awayScoreAfter!: number | null;
}

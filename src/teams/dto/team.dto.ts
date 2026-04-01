import { ApiProperty } from '@nestjs/swagger';
import { TeamSummaryDto } from '../../scores/dto/get-matches.dto.js';

export class PlayerSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() externalId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true }) position!: string | null;
  @ApiProperty({ nullable: true }) jerseyNumber!: number | null;
  @ApiProperty({ nullable: true }) nationality!: string | null;
}

export class TeamDetailDto {
  @ApiProperty() id!: string;
  @ApiProperty() externalId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() shortName!: string;
  @ApiProperty({ nullable: true }) logoUrl!: string | null;
  @ApiProperty() countryCode!: string;
  @ApiProperty({ nullable: true }) founded!: number | null;
  @ApiProperty({ nullable: true }) stadium!: string | null;
  @ApiProperty({ nullable: true }) website!: string | null;
  @ApiProperty({ type: [PlayerSummaryDto] }) squad!: PlayerSummaryDto[];
}

export { TeamSummaryDto };

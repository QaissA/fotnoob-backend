import { ApiProperty } from '@nestjs/swagger';
import { TeamSummaryDto } from '../../scores/dto/get-matches.dto.js';

export class PersonDto {
  @ApiProperty() id!: string;
  @ApiProperty() externalId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true }) dateOfBirth!: string | null;
  @ApiProperty({ nullable: true }) nationality!: string | null;
  @ApiProperty({ nullable: true }) position!: string | null;
  @ApiProperty({ nullable: true }) jerseyNumber!: number | null;
  @ApiProperty({ nullable: true }) photoUrl!: string | null;
  @ApiProperty({ nullable: true, type: TeamSummaryDto }) team!: TeamSummaryDto | null;
}

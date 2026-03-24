import { ApiProperty } from '@nestjs/swagger';

export class StatPairDto {
  @ApiProperty({ nullable: true }) home!: number | null;
  @ApiProperty({ nullable: true }) away!: number | null;
}

export class MatchStatsResponseDto {
  @ApiProperty() matchId!: string;
  @ApiProperty({ type: StatPairDto }) possession!: StatPairDto;
  @ApiProperty({ type: StatPairDto }) shots!: StatPairDto;
  @ApiProperty({ type: StatPairDto }) shotsOnTarget!: StatPairDto;
  @ApiProperty({ type: StatPairDto }) xG!: StatPairDto;
  @ApiProperty({ type: StatPairDto }) corners!: StatPairDto;
  @ApiProperty({ type: StatPairDto }) fouls!: StatPairDto;
  @ApiProperty({ type: StatPairDto }) passAccuracy!: StatPairDto;
  @ApiProperty({ nullable: true }) momentumData!: unknown;
}

export class PlayerRatingDto {
  @ApiProperty() playerId!: string;
  @ApiProperty() rating!: number;
  @ApiProperty() minutes!: number;
  @ApiProperty() goals!: number;
  @ApiProperty() assists!: number;
}

export class StandingRowDto {
  @ApiProperty() position!: number;
  @ApiProperty() teamId!: string;
  @ApiProperty() teamName!: string;
  @ApiProperty({ nullable: true }) teamLogo!: string | null;
  @ApiProperty() played!: number;
  @ApiProperty() won!: number;
  @ApiProperty() drawn!: number;
  @ApiProperty() lost!: number;
  @ApiProperty() goalsFor!: number;
  @ApiProperty() goalsAgainst!: number;
  @ApiProperty() points!: number;
  @ApiProperty({ nullable: true }) form!: string | null;
}

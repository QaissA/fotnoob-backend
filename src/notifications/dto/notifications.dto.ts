import { z } from 'zod';
import { ApiProperty } from '@nestjs/swagger';

export const RegisterFcmSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(['android', 'ios']),
});

export const UpdatePrefsSchema = z.object({
  goals: z.boolean().optional(),
  kickoff: z.boolean().optional(),
  lineups: z.boolean().optional(),
  finalWhistle: z.boolean().optional(),
  news: z.boolean().optional(),
});

export type RegisterFcmDto = z.infer<typeof RegisterFcmSchema>;
export type UpdatePrefsDto = z.infer<typeof UpdatePrefsSchema>;

export class NotificationPrefsDto {
  @ApiProperty() goals!: boolean;
  @ApiProperty() kickoff!: boolean;
  @ApiProperty() lineups!: boolean;
  @ApiProperty() finalWhistle!: boolean;
  @ApiProperty() news!: boolean;
}

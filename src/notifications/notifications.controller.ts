import {
  Controller,
  Post,
  Delete,
  Get,
  Put,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { CurrentUser, type JwtPayload } from '../common/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { NotificationsService } from './notifications.service.js';
import {
  RegisterFcmSchema,
  UpdatePrefsSchema,
  type RegisterFcmDto,
  type UpdatePrefsDto,
  NotificationPrefsDto,
} from './dto/notifications.dto.js';

@ApiTags('Notifications')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post('fcm-tokens')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Register an FCM device token' })
  @ApiResponse({ status: 204 })
  registerToken(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(RegisterFcmSchema)) dto: RegisterFcmDto,
  ): Promise<void> {
    return this.notifications.registerFcmToken(user.sub, dto);
  }

  @Delete('fcm-tokens/:token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a registered FCM device token' })
  @ApiParam({ name: 'token' })
  @ApiResponse({ status: 204 })
  removeToken(
    @CurrentUser() user: JwtPayload,
    @Param('token') token: string,
  ): Promise<void> {
    return this.notifications.removeFcmToken(user.sub, token);
  }

  @Get('prefs')
  @ApiOperation({ summary: 'Get notification preferences for current user' })
  @ApiResponse({ status: 200, type: NotificationPrefsDto })
  getPrefs(@CurrentUser() user: JwtPayload): Promise<NotificationPrefsDto> {
    return this.notifications.getPrefs(user.sub);
  }

  @Put('prefs')
  @ApiOperation({ summary: 'Update notification preferences' })
  @ApiResponse({ status: 200, type: NotificationPrefsDto })
  updatePrefs(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(UpdatePrefsSchema)) dto: UpdatePrefsDto,
  ): Promise<NotificationPrefsDto> {
    return this.notifications.updatePrefs(user.sub, dto);
  }
}

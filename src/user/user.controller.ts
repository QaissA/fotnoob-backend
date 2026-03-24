import {
  Controller,
  Post,
  Get,
  Put,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UserService } from './user.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { Public } from '../common/decorators/public.decorator.js';
import { CurrentUser, type JwtPayload } from '../common/decorators/current-user.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import {
  RegisterSchema,
  LoginSchema,
  RefreshSchema,
  type RegisterDto,
  type LoginDto,
  type RefreshDto,
  AuthResponseDto,
  TokenResponseDto,
  UserProfileDto,
} from './dto/auth.dto.js';
import { UpdateFavouritesSchema, type UpdateFavouritesDto, FavouritesResponseDto } from './dto/favourites.dto.js';

@ApiTags('Users')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UserController {
  constructor(private readonly users: UserService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, type: AuthResponseDto })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  register(
    @Body(new ZodValidationPipe(RegisterSchema)) dto: RegisterDto,
  ): Promise<AuthResponseDto> {
    return this.users.register(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate and receive JWT tokens' })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  login(
    @Body(new ZodValidationPipe(LoginSchema)) dto: LoginDto,
  ): Promise<AuthResponseDto> {
    return this.users.login(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate refresh token and issue new access token' })
  @ApiResponse({ status: 200, type: TokenResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  refresh(
    @Body(new ZodValidationPipe(RefreshSchema)) dto: RefreshDto,
  ): Promise<TokenResponseDto> {
    return this.users.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke all refresh tokens for the current user' })
  @ApiResponse({ status: 204 })
  logout(@CurrentUser() user: JwtPayload): Promise<void> {
    return this.users.logout(user.sub);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, type: UserProfileDto })
  getProfile(@CurrentUser() user: JwtPayload): Promise<UserProfileDto> {
    return this.users.getProfile(user.sub);
  }

  @Get('me/favourites')
  @ApiOperation({ summary: 'Get saved favourites (teams, leagues, players)' })
  @ApiResponse({ status: 200, type: FavouritesResponseDto })
  getFavourites(@CurrentUser() user: JwtPayload): Promise<FavouritesResponseDto> {
    return this.users.getFavourites(user.sub);
  }

  @Put('me/favourites')
  @ApiOperation({ summary: 'Replace favourites lists' })
  @ApiResponse({ status: 200, type: FavouritesResponseDto })
  updateFavourites(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(UpdateFavouritesSchema)) dto: UpdateFavouritesDto,
  ): Promise<FavouritesResponseDto> {
    return this.users.updateFavourites(user.sub, dto);
  }
}

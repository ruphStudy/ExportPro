import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { OrgContextService } from './org-context.service';
import { clearSessionCookie, setSessionCookie } from './lib/cookies';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { ResendVerificationDto, VerifyEmailDto } from './dto/verify-email.dto';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/password-reset.dto';
import { PrismaService } from '../../prisma/prisma.service';

const AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly orgContext: OrgContextService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('signup')
  signup(@Body() dto: SignupDto) {
    return this.auth.signup(dto);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('verify-email')
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto.email, dto.code);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('resend-verification')
  resendVerification(@Body() dto: ResendVerificationDto) {
    return this.auth.resendVerification(dto.email);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { rawToken, context } = await this.auth.login(dto, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
    setSessionCookie(res, rawToken, Boolean(dto.rememberMe));
    return context;
  }

  @Get('me')
  async me(@Req() req: Request) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: req.user!.id },
    });
    return this.orgContext.buildSessionContext(user, req.organizationId);
  }

  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.sessions.findActiveById(
      req.sessionId!,
      req.user!.id,
    );
    if (!session)
      throw new UnauthorizedException('Session expired or invalid.');

    const { rawToken, context } = await this.auth.refresh(session);
    setSessionCookie(res, rawToken, session.rememberMe);
    return context;
  }

  @HttpCode(HttpStatus.OK)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.sessionId!, req.user!.id);
    clearSessionCookie(res);
    return { message: 'Signed out.' };
  }

  @HttpCode(HttpStatus.OK)
  @Post('logout-others')
  logoutOthers(@Req() req: Request) {
    return this.auth
      .logoutOthers(req.user!.id, req.sessionId!)
      .then(() => ({ message: 'Signed out of other devices.' }));
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    if (dto.password !== dto.confirmPassword)
      throw new BadRequestException('Passwords do not match.');
    return this.auth.resetPassword(dto.token, dto.password);
  }

  @HttpCode(HttpStatus.OK)
  @Post('change-password')
  changePassword(
    @CurrentUser() user: { id: string },
    @Req() req: Request,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.auth.changePassword(
      user.id,
      req.sessionId!,
      dto.currentPassword,
      dto.newPassword,
    );
  }
}

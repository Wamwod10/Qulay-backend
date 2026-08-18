import { Body, Controller, Get, NotImplementedException, Post, Req } from "@nestjs/common";

import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Public } from "../../common/decorators/public.decorator";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("register")
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Post("login")
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @Post("reset-password")
  resetPassword() {
    throw new NotImplementedException({
      code: "PASSWORD_RESET_NOT_CONFIGURED",
      message: "Parolni tiklash uchun tasdiqlangan token yoki OTP kerak.",
    });
  }

  @Get("me")
  me(@CurrentUser("id") userId: string, @Req() request: any) {
    return this.auth.me(userId, request.companyId);
  }

  @Post("profile")
  profile(@CurrentUser("id") userId: string, @Body() body: any, @Req() request: any) {
    return this.auth.updateProfile(userId, body, request.companyId);
  }

  @Post("account")
  account(@CurrentUser("id") userId: string, @Body() body: any, @Req() request: any) {
    return this.auth.updateAccount(userId, request.companyId, body);
  }

  @Post("password")
  password(@CurrentUser("id") userId: string, @Body() body: any) {
    return this.auth.changePassword(userId, body);
  }

  @Post("logout")
  logout() {
    return this.auth.logout();
  }
}

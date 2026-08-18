import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";

@Injectable()
export class JwtRefreshGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();

    if (!request.headers.authorization) {
      throw new UnauthorizedException({ code: "REFRESH_TOKEN_REQUIRED", message: "Refresh token topilmadi." });
    }

    return true;
  }
}

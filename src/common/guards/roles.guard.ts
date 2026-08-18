import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { ROLES_KEY } from "../decorators/roles.decorator";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector = new Reflector()) {}

  canActivate(context: ExecutionContext) {
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!roles?.length) {
      return true;
    }

    const user = context.switchToHttp().getRequest().user;

    if (user?.role === "SUPER_ADMIN" || roles.includes(user?.role)) {
      return true;
    }

    throw new ForbiddenException({ code: "ROLE_FORBIDDEN", message: "Rol ruxsati yetarli emas." });
  }
}

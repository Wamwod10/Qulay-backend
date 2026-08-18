import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { PERMISSIONS_KEY } from "../decorators/permissions.decorator";

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector = new Reflector()) {}

  canActivate(context: ExecutionContext) {
    const permissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!permissions?.length) {
      return true;
    }

    const user = context.switchToHttp().getRequest().user;

    if (user?.role === "SUPER_ADMIN" || user?.permissions?.includes("*")) {
      return true;
    }

    const allowed = permissions.every((permission) => user?.permissions?.includes(permission));

    if (!allowed) {
      throw new ForbiddenException({
        code: "PERMISSION_FORBIDDEN",
        message: "Permission yetarli emas.",
      });
    }

    return true;
  }
}

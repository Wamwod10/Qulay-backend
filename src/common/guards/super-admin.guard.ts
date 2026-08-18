import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";

import { SUPER_ADMIN_ROLE } from "../constants/user-role.constants";

@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();

    if (request.user?.role !== SUPER_ADMIN_ROLE) {
      throw new ForbiddenException({
        code: "SUPER_ADMIN_ONLY",
        message: "Faqat Super Admin uchun.",
      });
    }

    return true;
  }
}

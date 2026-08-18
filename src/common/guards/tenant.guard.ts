import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";

import { SUPER_ADMIN_ROLE } from "../constants/user-role.constants";

@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();

    if (request.user?.role === SUPER_ADMIN_ROLE || request.companyId) {
      return true;
    }

    throw new ForbiddenException({ code: "TENANT_REQUIRED", message: "Kompaniya tanlanmagan." });
  }
}

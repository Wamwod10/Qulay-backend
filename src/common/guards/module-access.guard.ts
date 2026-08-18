import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { MODULES_KEY } from "../decorators/modules.decorator";
import { PrismaService } from "../../database/prisma.service";
import { SUPER_ADMIN_ROLE } from "../constants/user-role.constants";

@Injectable()
export class ModuleAccessGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector = new Reflector(),
  ) {}

  async canActivate(context: ExecutionContext) {
    const moduleKeys = this.reflector.getAllAndOverride<string[]>(MODULES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!moduleKeys?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (user?.role === SUPER_ADMIN_ROLE) {
      return true;
    }

    const companyId = request.companyId;

    if (!companyId) {
      throw new ForbiddenException({ code: "TENANT_REQUIRED", message: "Kompaniya tanlanmagan." });
    }

    const modules = await this.prisma.platformModule.findMany({
      where: { key: { in: moduleKeys } },
      include: {
        companyAccess: {
          where: { companyId },
        },
      },
    });

    const allowed = moduleKeys.every((moduleKey) => {
      const module = modules.find((item) => item.key === moduleKey);
      const companyAccess = module?.companyAccess[0];

      // A missing platform module or account override is not an implicit grant.
      // Account access is provisioned during authentication; denying here keeps
      // a race/partial migration from opening a disabled module.
      return Boolean(module?.enabled && companyAccess?.enabled);
    });

    if (!allowed) {
      throw new ForbiddenException({ code: "MODULE_DISABLED", message: "Bo'lim o'chirilgan." });
    }

    return true;
  }
}

import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { MODULES_KEY } from "../decorators/modules.decorator";
import { INLINE_CREATE_MODULES_KEY } from "../decorators/inline-create.decorator";
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

    const isEnabled = async (keys: string[]) => {
      const modules = await this.prisma.platformModule.findMany({
        where: { key: { in: keys } },
        include: { companyAccess: { where: { companyId } } },
      });

      return keys.every((moduleKey) => {
        const module = modules.find((item) => item.key === moduleKey);
        const companyAccess = module?.companyAccess[0];
        // A missing platform module or account override is not an implicit grant.
        return Boolean(module?.enabled && companyAccess?.enabled);
      });
    };

    let allowed = await isEnabled(moduleKeys);

    if (!allowed && request.method === "POST") {
      const inlineModules = this.reflector.getAllAndOverride<string[]>(INLINE_CREATE_MODULES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) || [];
      const requestedParent = String(request.headers["x-inline-parent-module"] || "").trim();

      // Inline creation can use the parent workflow only when the route
      // explicitly opted in and that parent is enabled for this company.
      allowed = Boolean(requestedParent && inlineModules.includes(requestedParent))
        && await isEnabled([requestedParent]);
    }

    if (!allowed) {
      throw new ForbiddenException({ code: "MODULE_DISABLED", message: "Bu bo'lim hozircha o'chirilgan." });
    }

    return true;
  }
}

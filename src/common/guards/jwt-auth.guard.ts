import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";

import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { ROLE_PERMISSION_MAP } from "../constants/permissions.constants";
import { SUPER_ADMIN_ROLE } from "../constants/user-role.constants";
import { PrismaService } from "../../database/prisma.service";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector = new Reflector(),
  ) {}

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader = String(request.headers.authorization || "");
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!token) {
      throw new UnauthorizedException({ code: "UNAUTHENTICATED", message: "Token topilmadi." });
    }

    let payload: { sub?: string };

    try {
      payload = await this.jwt.verifyAsync(token, {
        secret: this.config.get<string>("JWT_SECRET"),
      });
    } catch {
      this.logger.warn("auth.request_rejected reason=invalid_token");
      throw new UnauthorizedException({ code: "INVALID_TOKEN", message: "Token yaroqsiz." });
    }

    if (!payload.sub) {
      throw new UnauthorizedException({ code: "INVALID_TOKEN", message: "Token yaroqsiz." });
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        memberships: {
          include: {
            company: true,
          },
        },
      },
    });

    if (!user || user.status !== "ACTIVE" || user.deletedAt) {
      this.logger.warn("auth.request_rejected reason=inactive_account");
      throw new ForbiddenException({
        code: "ACCOUNT_BLOCKED",
        message: "Foydalanuvchi faol emas.",
      });
    }

    const requestedCompanyId =
      String(request.headers["x-company-id"] || "") ||
      user.memberships[0]?.companyId ||
      null;

    const membership = requestedCompanyId
      ? user.memberships.find((item) => item.companyId === requestedCompanyId)
      : user.memberships[0];

    if (user.role !== SUPER_ADMIN_ROLE) {
      if (!membership) {
        throw new ForbiddenException({
          code: "TENANT_REQUIRED",
          message: "Kompaniya access topilmadi.",
        });
      }

      if (membership.company.status !== "ACTIVE" || membership.company.deletedAt) {
        this.logger.warn("auth.request_rejected reason=inactive_company");
        throw new ForbiddenException({
          code: "COMPANY_BLOCKED",
          message: "Kompaniya bloklangan.",
        });
      }
    }

    const companyId = user.role === SUPER_ADMIN_ROLE ? requestedCompanyId : membership?.companyId;
    const role = user.role === SUPER_ADMIN_ROLE ? user.role : membership?.role || user.role;

    request.user = {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      role,
      status: user.status,
      companyId,
      companyIds: user.memberships.map((item) => item.companyId),
      permissions: ROLE_PERMISSION_MAP[role] || [],
    };
    request.companyId = companyId;

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastActiveAt: new Date() },
    });

    return true;
  }
}

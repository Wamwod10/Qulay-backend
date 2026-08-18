import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";

import { PLATFORM_MODULES } from "../../common/constants/modules.constants";
import { ROLE_PERMISSION_MAP } from "../../common/constants/permissions.constants";
import { PrismaService } from "../../database/prisma.service";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";

const normalizeEmail = (email?: string | null) => String(email || "").trim().toLowerCase();
const normalizePhone = (phone?: string | null) => String(phone || "").replace(/\s+/g, " ").trim();

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    if (dto.confirmPassword && dto.password !== dto.confirmPassword) {
      throw new BadRequestException({ code: "PASSWORD_MISMATCH", message: "Parollar mos emas." });
    }

    const email = normalizeEmail(dto.email);
    const phone = normalizePhone(dto.phone);
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [{ email }, { phone }],
      },
    });

    if (existing) {
      throw new ConflictException({
        code: "USER_EXISTS",
        message: "Bu email yoki telefon bilan account mavjud.",
      });
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const result = await this.prisma.$transaction(async (tx) => {
      const modules = await this.ensurePlatformModules(tx);
      const user = await tx.user.create({
        data: {
          fullName: dto.fullName.trim(),
          email,
          phone,
          passwordHash,
          role: "OWNER",
          status: "ACTIVE",
          jobTitle: "Owner",
          lastActiveAt: new Date(),
        },
      });
      const company = await tx.company.create({
        data: {
          name: dto.businessName.trim(),
          businessName: dto.businessName.trim(),
          businessType: dto.businessType?.trim() || null,
          phone,
          email,
          country: dto.country?.trim() || "Uzbekistan",
          currency: dto.currency || "UZS",
          ownerUserId: user.id,
        },
      });

      await tx.companyMember.create({
        data: {
          userId: user.id,
          companyId: company.id,
          role: "OWNER",
        },
      });
      await tx.companyModuleAccess.createMany({
        data: modules.map((module) => ({
          companyId: company.id,
          moduleId: module.id,
          enabled: true,
        })),
        skipDuplicates: true,
      });
      await tx.warehouse.create({
        data: {
          companyId: company.id,
          name: "Asosiy ombor",
          code: "MAIN",
        },
      });
      await tx.cashbox.create({
        data: {
          companyId: company.id,
          name: "Asosiy kassa",
          currency: company.currency,
        },
      });
      await tx.branch.create({
        data: {
          companyId: company.id,
          name: "Asosiy filial",
        },
      });
      await tx.auditLog.create({
        data: {
          companyId: company.id,
          actorUserId: user.id,
          action: "company.registered",
          targetType: "company",
          targetId: company.id,
          metadata: { userId: user.id },
        },
      });

      return { user, company };
    });

    return this.buildAuthResult(result.user.id, result.company.id, dto.rememberMe ?? true);
  }

  async login(dto: LoginDto) {
    const identifier = String(dto.identifier || "").trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: identifier },
          { phone: dto.identifier.trim() },
        ],
      },
      include: {
        memberships: {
          include: { company: true },
        },
      },
    });

    if (!user || user.deletedAt) {
      this.logger.warn("auth.login_failed reason=invalid_credentials");
      throw new UnauthorizedException({ code: "INVALID_CREDENTIALS", message: "Email yoki parol noto'g'ri." });
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);

    if (!valid) {
      this.logger.warn("auth.login_failed reason=invalid_credentials");
      throw new UnauthorizedException({ code: "INVALID_CREDENTIALS", message: "Email yoki parol noto'g'ri." });
    }

    if (user.status !== "ACTIVE") {
      this.logger.warn("auth.login_blocked reason=inactive_account");
      throw new UnauthorizedException({ code: "ACCOUNT_BLOCKED", message: "Foydalanuvchi bloklangan." });
    }

    const company = user.memberships[0]?.company || null;

    if (user.role !== "SUPER_ADMIN" && (!company || company.status !== "ACTIVE" || company.deletedAt)) {
      this.logger.warn("auth.login_blocked reason=inactive_company");
      throw new UnauthorizedException({ code: "COMPANY_BLOCKED", message: "Kompaniya bloklangan." });
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastActiveAt: new Date() },
    });

    return this.buildAuthResult(user.id, company?.id || null, Boolean(dto.rememberMe));
  }

  async me(userId: string, companyId?: string | null) {
    return this.buildAuthResult(userId, companyId || null, true);
  }

  logout() {
    return {
      success: true,
    };
  }

  async updateProfile(userId: string, dto: any, companyId?: string | null) {
    const email = normalizeEmail(dto.email);
    const phone = normalizePhone(dto.phone);
    const duplicate = await this.prisma.user.findFirst({
      where: { OR: [{ email }, { phone }], NOT: { id: userId } },
    });
    if (duplicate) throw new ConflictException({ code: "USER_EXISTS", message: "Bu email yoki telefon band." });

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        fullName: String(dto.fullName || "").trim(),
        email,
        phone,
        jobTitle: dto.jobTitle === undefined ? undefined : dto.jobTitle,
        avatar: dto.avatar === undefined ? undefined : dto.avatar,
      },
    });
    return this.buildAuthResult(userId, companyId && companyId !== "platform" ? companyId : null, true);
  }

  async updateAccount(userId: string, companyId: string | null | undefined, dto: any) {
    if (!companyId || companyId === "platform") throw new BadRequestException({ code: "TENANT_REQUIRED", message: "Kompaniya tanlanmagan." });
    const membership = await this.prisma.companyMember.findFirst({ where: { userId, companyId } });
    if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) {
      throw new ForbiddenException({ code: "ACCOUNT_UPDATE_FORBIDDEN", message: "Kompaniya profilini o'zgartirishga ruxsat yo'q." });
    }
    await this.prisma.company.update({
      where: { id: companyId },
      data: {
        name: dto.businessName === undefined ? undefined : String(dto.businessName).trim(),
        businessName: dto.businessName === undefined ? undefined : String(dto.businessName).trim(),
        businessType: dto.businessType,
        phone: dto.phone,
        email: dto.email,
        address: dto.address,
        country: dto.country,
        currency: dto.currency,
        taxId: dto.taxId,
        logo: dto.logo,
      },
    });
    return this.buildAuthResult(userId, companyId, true);
  }

  async changePassword(userId: string, dto: any) {
    const currentPassword = String(dto.currentPassword || "");
    const nextPassword = String(dto.newPassword || "");
    if (nextPassword.length < 8 || (dto.confirmPassword && nextPassword !== dto.confirmPassword)) {
      throw new BadRequestException({ code: "PASSWORD_INVALID", message: "Yangi parol kamida 8 belgidan iborat bo'lsin." });
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new UnauthorizedException({ code: "CURRENT_PASSWORD_INVALID", message: "Joriy parol noto'g'ri." });
    }
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(nextPassword, 12) } });
    return { success: true };
  }

  async ensurePlatformModules(tx: any = this.prisma) {
    const modules: any[] = [];

    for (const item of PLATFORM_MODULES) {
      modules.push(
        await tx.platformModule.upsert({
          where: { key: item.key },
          update: {
            name: item.name,
            locked: Boolean(item.locked),
          },
          create: {
            key: item.key,
            name: item.name,
            locked: Boolean(item.locked),
            enabled: true,
          },
        }),
      );
    }

    return modules;
  }

  private async buildAuthResult(userId: string, companyId: string | null, rememberMe: boolean) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        memberships: {
          include: {
            company: true,
          },
        },
      },
    });
    const membership = companyId
      ? user.memberships.find((item) => item.companyId === companyId)
      : user.memberships[0];
    const company = membership?.company || null;
    const role = user.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : membership?.role || user.role;
    const permissions = ROLE_PERMISSION_MAP[role] || [];
    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        role,
      },
      {
        secret: this.config.get<string>("JWT_SECRET"),
        expiresIn: (this.config.get<string>("JWT_EXPIRES_IN") || "7d") as any,
      },
    );

    if (company) {
      await this.ensureCompanyModules(company.id);
    }

    const moduleAccess = company
      ? await this.prisma.companyModuleAccess.findMany({
          where: { companyId: company.id },
          include: { module: true },
        })
      : [];

    const safeUser = {
      id: user.id,
      fullName: user.fullName,
      name: user.fullName,
      email: user.email,
      phone: user.phone,
      role,
      status: user.status,
      avatar: user.avatar || "",
      jobTitle: user.jobTitle || "",
      companyId: company?.id || null,
      businessId: company?.id || null,
      accountId: company?.id || (role === "SUPER_ADMIN" ? "platform" : null),
      companyName: company?.name || null,
      businessName: company?.businessName || company?.name || null,
      permissions,
      modules: moduleAccess
        .filter((access) => access.enabled && access.module.enabled)
        .map((access) => access.module.key),
      lastActiveAt: user.lastActiveAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
    const account = company
      ? {
          id: company.id,
          businessName: company.businessName || company.name,
          name: company.name,
          businessType: company.businessType,
          phone: company.phone,
          email: company.email,
          logo: company.logo || "",
          address: company.address || "",
          country: company.country || "Uzbekistan",
          currency: company.currency,
          taxId: company.taxId || "",
          status: company.status,
          createdAt: company.createdAt,
          updatedAt: company.updatedAt,
        }
      : {
          id: "platform",
          businessName: "Universal Platform",
          name: "Universal Platform",
          status: "ACTIVE",
          currency: "UZS",
        };

    return {
      user: safeUser,
      account,
      session: {
        userId: user.id,
        accountId: account.id,
        loginAt: new Date().toISOString(),
        rememberMe,
      },
      accessToken,
      modules: moduleAccess
        .filter((access) => access.enabled && access.module.enabled)
        .map((access) => access.module.key),
      moduleAccess: moduleAccess.map((access) => ({
        key: access.module.key,
        moduleKey: access.module.key,
        enabled: access.enabled,
        globalEnabled: access.module.enabled,
        effectiveEnabled: access.enabled && access.module.enabled,
      })),
      isAuthenticated: true,
    };
  }

  private async ensureCompanyModules(companyId: string) {
    const modules = await this.ensurePlatformModules();

    await this.prisma.companyModuleAccess.createMany({
      data: modules.map((module) => ({
        companyId,
        moduleId: module.id,
        enabled: true,
      })),
      skipDuplicates: true,
    });
  }
}

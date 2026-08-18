"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var JwtAuthGuard_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.JwtAuthGuard = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const core_1 = require("@nestjs/core");
const jwt_1 = require("@nestjs/jwt");
const public_decorator_1 = require("../decorators/public.decorator");
const permissions_constants_1 = require("../constants/permissions.constants");
const prisma_service_1 = require("../../database/prisma.service");
let JwtAuthGuard = JwtAuthGuard_1 = class JwtAuthGuard {
    jwt;
    config;
    prisma;
    reflector;
    logger = new common_1.Logger(JwtAuthGuard_1.name);
    constructor(jwt, config, prisma, reflector = new core_1.Reflector()) {
        this.jwt = jwt;
        this.config = config;
        this.prisma = prisma;
        this.reflector = reflector;
    }
    async canActivate(context) {
        const isPublic = this.reflector.getAllAndOverride(public_decorator_1.IS_PUBLIC_KEY, [
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
            throw new common_1.UnauthorizedException({ code: "UNAUTHENTICATED", message: "Token topilmadi." });
        }
        let payload;
        try {
            payload = await this.jwt.verifyAsync(token, {
                secret: this.config.get("JWT_SECRET"),
            });
        }
        catch {
            this.logger.warn("auth.request_rejected reason=invalid_token");
            throw new common_1.UnauthorizedException({ code: "INVALID_TOKEN", message: "Token yaroqsiz." });
        }
        if (!payload.sub) {
            throw new common_1.UnauthorizedException({ code: "INVALID_TOKEN", message: "Token yaroqsiz." });
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
            throw new common_1.UnauthorizedException({
                code: "ACCOUNT_BLOCKED",
                message: "Foydalanuvchi faol emas.",
            });
        }
        const requestedCompanyId = String(request.headers["x-company-id"] || "") ||
            user.memberships[0]?.companyId ||
            null;
        const membership = requestedCompanyId
            ? user.memberships.find((item) => item.companyId === requestedCompanyId)
            : user.memberships[0];
        if (user.role !== "SUPER_ADMIN") {
            if (!membership) {
                throw new common_1.UnauthorizedException({
                    code: "TENANT_REQUIRED",
                    message: "Kompaniya access topilmadi.",
                });
            }
            if (membership.company.status !== "ACTIVE" || membership.company.deletedAt) {
                this.logger.warn("auth.request_rejected reason=inactive_company");
                throw new common_1.UnauthorizedException({
                    code: "COMPANY_BLOCKED",
                    message: "Kompaniya bloklangan.",
                });
            }
        }
        const companyId = user.role === "SUPER_ADMIN" ? requestedCompanyId : membership?.companyId;
        const role = user.role === "SUPER_ADMIN" ? user.role : membership?.role || user.role;
        request.user = {
            id: user.id,
            fullName: user.fullName,
            email: user.email,
            phone: user.phone,
            role,
            status: user.status,
            companyId,
            companyIds: user.memberships.map((item) => item.companyId),
            permissions: permissions_constants_1.ROLE_PERMISSION_MAP[role] || [],
        };
        request.companyId = companyId;
        await this.prisma.user.update({
            where: { id: user.id },
            data: { lastActiveAt: new Date() },
        });
        return true;
    }
};
exports.JwtAuthGuard = JwtAuthGuard;
exports.JwtAuthGuard = JwtAuthGuard = JwtAuthGuard_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [jwt_1.JwtService,
        config_1.ConfigService,
        prisma_service_1.PrismaService,
        core_1.Reflector])
], JwtAuthGuard);
//# sourceMappingURL=jwt-auth.guard.js.map
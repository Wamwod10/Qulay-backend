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
var PlatformAdminService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlatformAdminService = void 0;
const common_1 = require("@nestjs/common");
const modules_constants_1 = require("../../common/constants/modules.constants");
const pagination_util_1 = require("../../common/utils/pagination.util");
const prisma_service_1 = require("../../database/prisma.service");
const toNumber = (value) => {
    if (value && typeof value === "object" && "toNumber" in value) {
        return value.toNumber();
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
};
let PlatformAdminService = PlatformAdminService_1 = class PlatformAdminService {
    prisma;
    logger = new common_1.Logger(PlatformAdminService_1.name);
    constructor(prisma) {
        this.prisma = prisma;
    }
    async dashboard() {
        await this.ensureModules();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const [totalUsers, activeUsers, blockedUsers, newUsersToday, totalCompanies, activeCompanies, recentUsers, modules, auditLogs,] = await Promise.all([
            this.prisma.user.count({ where: { deletedAt: null } }),
            this.prisma.user.count({ where: { status: "ACTIVE", deletedAt: null } }),
            this.prisma.user.count({ where: { status: "BLOCKED", deletedAt: null } }),
            this.prisma.user.count({ where: { createdAt: { gte: today }, deletedAt: null } }),
            this.prisma.company.count({ where: { deletedAt: null } }),
            this.prisma.company.count({ where: { status: "ACTIVE", deletedAt: null } }),
            this.prisma.user.findMany({
                where: { deletedAt: null },
                orderBy: { createdAt: "desc" },
                take: 8,
                include: { memberships: { include: { company: true } } },
            }),
            this.prisma.platformModule.findMany({ orderBy: { key: "asc" } }),
            this.prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
        ]);
        return {
            stats: {
                users: totalUsers,
                totalUsers,
                activeUsers,
                blockedUsers,
                newUsersToday,
                companies: totalCompanies,
                totalCompanies,
                activeCompanies,
            },
            recentRegistrations: recentUsers.map((user) => this.serializeUser(user)),
            modules: modules.map((module) => this.serializeModule(module)),
            recentActivity: auditLogs,
        };
    }
    async listUsers(query) {
        const { page, limit, skip, take } = (0, pagination_util_1.getPagination)(Number(query.page), Number(query.limit));
        const search = query.search?.trim();
        const status = query.status?.trim().toUpperCase();
        const companyId = query.companyId?.trim();
        const where = { deletedAt: null };
        if (status && ["ACTIVE", "BLOCKED"].includes(status)) {
            where.status = status;
        }
        if (search) {
            where.OR = [
                { fullName: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
                { phone: { contains: search, mode: "insensitive" } },
                { memberships: { some: { company: { name: { contains: search, mode: "insensitive" } } } } },
            ];
        }
        if (companyId) {
            where.memberships = { some: { companyId } };
        }
        const [total, users] = await Promise.all([
            this.prisma.user.count({ where }),
            this.prisma.user.findMany({
                where,
                skip,
                take,
                orderBy: { createdAt: "desc" },
                include: { memberships: { include: { company: true } } },
            }),
        ]);
        return {
            users: users.map((user) => this.serializeUser(user)),
            meta: (0, pagination_util_1.getPaginationMeta)(page, limit, total),
        };
    }
    async getUser(userId) {
        const user = await this.prisma.user.findFirst({
            where: { id: userId, deletedAt: null },
            include: {
                memberships: {
                    include: {
                        company: {
                            include: {
                                modules: { include: { module: true } },
                            },
                        },
                    },
                },
            },
        });
        if (!user) {
            throw new common_1.NotFoundException({ code: "USER_NOT_FOUND", message: "User topilmadi." });
        }
        const serialized = this.serializeUser(user);
        const company = user.memberships[0]?.company;
        return {
            ...serialized,
            modules: company?.modules.map((access) => ({
                key: access.module.key,
                moduleKey: access.module.key,
                enabled: access.enabled,
                globalEnabled: access.module.enabled,
                effectiveEnabled: access.enabled && access.module.enabled,
            })) || [],
        };
    }
    async updateUserStatus(userId, status, actorId, ip) {
        if (userId === actorId) {
            throw new common_1.ForbiddenException({ code: "SELF_STATUS_CHANGE", message: "Super Admin o'zini bloklay olmaydi." });
        }
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user || user.deletedAt) {
            throw new common_1.NotFoundException({ code: "USER_NOT_FOUND", message: "User topilmadi." });
        }
        if (user.role === "SUPER_ADMIN") {
            throw new common_1.ForbiddenException({ code: "SUPER_ADMIN_PROTECTED", message: "Super Admin himoyalangan." });
        }
        const updated = await this.prisma.user.update({
            where: { id: userId },
            data: { status },
            include: { memberships: { include: { company: true } } },
        });
        await this.audit({
            actorUserId: actorId,
            action: status === "BLOCKED" ? "user.blocked" : "user.unblocked",
            targetType: "user",
            targetId: userId,
            metadata: { status },
            ip,
        });
        return this.serializeUser(updated);
    }
    async deleteUser(userId, actorId, ip) {
        if (userId === actorId) {
            throw new common_1.ForbiddenException({ code: "SELF_DELETE", message: "Super Admin o'zini o'chira olmaydi." });
        }
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            include: { memberships: true },
        });
        if (!user || user.deletedAt) {
            throw new common_1.NotFoundException({ code: "USER_NOT_FOUND", message: "User topilmadi." });
        }
        if (user.role === "SUPER_ADMIN") {
            throw new common_1.ForbiddenException({ code: "SUPER_ADMIN_PROTECTED", message: "Super Admin himoyalangan." });
        }
        const ownsCompany = await this.prisma.company.count({
            where: { ownerUserId: userId, deletedAt: null },
        });
        await this.prisma.user.update({
            where: { id: userId },
            data: {
                status: "DELETED",
                deletedAt: new Date(),
            },
        });
        await this.audit({
            actorUserId: actorId,
            action: "user.deleted",
            targetType: "user",
            targetId: userId,
            metadata: { softDelete: true, ownsCompany: ownsCompany > 0 },
            ip,
        });
        return { deleted: true, softDelete: true };
    }
    async listCompanies(query) {
        const { page, limit, skip, take } = (0, pagination_util_1.getPagination)(Number(query.page), Number(query.limit));
        const search = query.search?.trim();
        const status = query.status?.trim().toUpperCase();
        const where = { deletedAt: null };
        if (status && ["ACTIVE", "BLOCKED"].includes(status)) {
            where.status = status;
        }
        if (search) {
            where.OR = [
                { name: { contains: search, mode: "insensitive" } },
                { businessName: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
                { phone: { contains: search, mode: "insensitive" } },
            ];
        }
        const [total, companies] = await Promise.all([
            this.prisma.company.count({ where }),
            this.prisma.company.findMany({
                where,
                skip,
                take,
                orderBy: { createdAt: "desc" },
                include: {
                    members: { include: { user: true } },
                    modules: { include: { module: true } },
                    _count: { select: { sales: true, products: true } },
                },
            }),
        ]);
        return {
            companies: companies.map((company) => this.serializeCompany(company)),
            meta: (0, pagination_util_1.getPaginationMeta)(page, limit, total),
        };
    }
    async getCompany(companyId) {
        const company = await this.prisma.company.findFirst({
            where: { id: companyId, deletedAt: null },
            include: {
                members: { include: { user: true } },
                modules: { include: { module: true } },
                sales: { orderBy: { createdAt: "desc" }, take: 5 },
                _count: { select: { sales: true, products: true, customers: true, suppliers: true } },
            },
        });
        if (!company) {
            throw new common_1.NotFoundException({ code: "COMPANY_NOT_FOUND", message: "Kompaniya topilmadi." });
        }
        const activity = await this.prisma.auditLog.findMany({
            where: { companyId },
            orderBy: { createdAt: "desc" },
            take: 10,
        });
        return {
            ...this.serializeCompany(company),
            users: company.members.map((member) => this.serializeUser({ ...member.user, memberships: [member] })),
            recentSales: company.sales.map((sale) => ({
                id: sale.id,
                number: sale.number,
                total: toNumber(sale.total),
                status: sale.status,
                createdAt: sale.createdAt,
            })),
            activity,
        };
    }
    async updateCompanyStatus(companyId, status, actorId, ip) {
        const company = await this.prisma.company.findFirst({ where: { id: companyId, deletedAt: null } });
        if (!company) {
            throw new common_1.NotFoundException({ code: "COMPANY_NOT_FOUND", message: "Kompaniya topilmadi." });
        }
        const updated = await this.prisma.company.update({
            where: { id: companyId },
            data: { status },
            include: {
                members: { include: { user: true } },
                modules: { include: { module: true } },
                _count: { select: { sales: true, products: true } },
            },
        });
        await this.audit({
            companyId,
            actorUserId: actorId,
            action: status === "BLOCKED" ? "company.blocked" : "company.unblocked",
            targetType: "company",
            targetId: companyId,
            metadata: { status },
            ip,
        });
        return this.serializeCompany(updated);
    }
    async getModules() {
        await this.ensureModules();
        const modules = await this.prisma.platformModule.findMany({ orderBy: { key: "asc" } });
        return {
            modules: modules.map((module) => this.serializeModule(module)),
        };
    }
    async updateModule(moduleKey, enabled, actorId, ip) {
        await this.ensureModules();
        const module = await this.prisma.platformModule.findUnique({ where: { key: moduleKey } });
        if (!module) {
            throw new common_1.NotFoundException({ code: "MODULE_NOT_FOUND", message: "Bo'lim topilmadi." });
        }
        if (module.locked && !enabled) {
            throw new common_1.ConflictException({ code: "MODULE_LOCKED", message: "Majburiy bo'lim o'chirilmaydi." });
        }
        const updated = await this.prisma.platformModule.update({
            where: { key: moduleKey },
            data: { enabled: module.locked ? true : enabled },
        });
        await this.audit({
            actorUserId: actorId,
            action: enabled ? "module.global_enabled" : "module.global_disabled",
            targetType: "platformModule",
            targetId: moduleKey,
            metadata: { enabled },
            ip,
        });
        return this.serializeModule(updated);
    }
    async getCompanyModules(companyId) {
        await this.ensureCompanyModuleAccess(companyId);
        const accesses = await this.prisma.companyModuleAccess.findMany({
            where: { companyId },
            include: { module: true },
            orderBy: { module: { key: "asc" } },
        });
        return {
            modules: accesses.map((access) => ({
                key: access.module.key,
                moduleKey: access.module.key,
                name: access.module.name,
                enabled: access.enabled,
                globalEnabled: access.module.enabled,
                locked: access.module.locked,
                effectiveEnabled: access.enabled && access.module.enabled,
            })),
        };
    }
    async updateCompanyModule(companyId, moduleKey, enabled, actorId, ip) {
        await this.ensureCompanyModuleAccess(companyId);
        const module = await this.prisma.platformModule.findUnique({ where: { key: moduleKey } });
        if (!module) {
            throw new common_1.NotFoundException({ code: "MODULE_NOT_FOUND", message: "Bo'lim topilmadi." });
        }
        if (module.locked && !enabled) {
            throw new common_1.ConflictException({ code: "MODULE_LOCKED", message: "Majburiy bo'lim o'chirilmaydi." });
        }
        const access = await this.prisma.companyModuleAccess.update({
            where: { companyId_moduleId: { companyId, moduleId: module.id } },
            data: { enabled: module.locked ? true : enabled },
            include: { module: true },
        });
        await this.audit({
            companyId,
            actorUserId: actorId,
            action: enabled ? "company_module.enabled" : "company_module.disabled",
            targetType: "companyModule",
            targetId: `${companyId}:${moduleKey}`,
            metadata: { companyId, moduleKey, enabled },
            ip,
        });
        return {
            key: access.module.key,
            moduleKey: access.module.key,
            enabled: access.enabled,
            globalEnabled: access.module.enabled,
            effectiveEnabled: access.enabled && access.module.enabled,
        };
    }
    async auditLogs(query) {
        const { page, limit, skip, take } = (0, pagination_util_1.getPagination)(Number(query.page), Number(query.limit));
        const companyId = query.companyId?.trim();
        const action = query.action?.trim();
        const where = {};
        if (companyId) {
            where.companyId = companyId;
        }
        if (action) {
            where.action = { contains: action, mode: "insensitive" };
        }
        const [total, logs] = await Promise.all([
            this.prisma.auditLog.count({ where }),
            this.prisma.auditLog.findMany({ where, skip, take, orderBy: { createdAt: "desc" } }),
        ]);
        return {
            logs,
            auditLogs: logs,
            meta: (0, pagination_util_1.getPaginationMeta)(page, limit, total),
        };
    }
    async ensureCompanyModuleAccess(companyId) {
        const company = await this.prisma.company.findFirst({ where: { id: companyId, deletedAt: null } });
        if (!company) {
            throw new common_1.NotFoundException({ code: "COMPANY_NOT_FOUND", message: "Kompaniya topilmadi." });
        }
        const modules = await this.ensureModules();
        await this.prisma.companyModuleAccess.createMany({
            data: modules.map((module) => ({
                companyId,
                moduleId: module.id,
                enabled: true,
            })),
            skipDuplicates: true,
        });
    }
    async ensureModules() {
        const modules = [];
        for (const item of modules_constants_1.PLATFORM_MODULES) {
            modules.push(await this.prisma.platformModule.upsert({
                where: { key: item.key },
                update: { name: item.name, locked: Boolean(item.locked) },
                create: { key: item.key, name: item.name, locked: Boolean(item.locked), enabled: true },
            }));
        }
        return modules;
    }
    async audit(data) {
        this.logger.log(`superadmin.action action=${data.action} targetType=${data.targetType} targetId=${data.targetId}`);
        return this.prisma.auditLog.create({
            data: {
                companyId: data.companyId || null,
                actorUserId: data.actorUserId || null,
                action: data.action,
                targetType: data.targetType,
                targetId: data.targetId,
                metadata: (data.metadata || {}),
                ip: data.ip,
            },
        });
    }
    serializeUser(user) {
        const membership = user.memberships?.[0];
        const company = membership?.company;
        return {
            id: user.id,
            fullName: user.fullName,
            name: user.fullName,
            email: user.email,
            phone: user.phone,
            role: user.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : membership?.role || user.role,
            status: user.status,
            companyId: company?.id || null,
            businessId: company?.id || null,
            accountId: company?.id || null,
            companyName: company?.name || null,
            businessName: company?.businessName || company?.name || null,
            lastActiveAt: user.lastActiveAt,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
        };
    }
    serializeCompany(company) {
        const ownerMember = company.members?.find((member) => member.role === "OWNER") ||
            company.members?.find((member) => member.userId === company.ownerUserId);
        return {
            id: company.id,
            name: company.name,
            businessName: company.businessName || company.name,
            businessType: company.businessType,
            phone: company.phone,
            email: company.email,
            address: company.address,
            country: company.country,
            currency: company.currency,
            status: company.status,
            ownerUserId: company.ownerUserId,
            owner: ownerMember?.user
                ? {
                    id: ownerMember.user.id,
                    fullName: ownerMember.user.fullName,
                    email: ownerMember.user.email,
                    phone: ownerMember.user.phone,
                }
                : null,
            usersCount: company.members?.length || 0,
            modules: company.modules?.map((access) => ({
                key: access.module.key,
                moduleKey: access.module.key,
                enabled: access.enabled,
                globalEnabled: access.module.enabled,
                effectiveEnabled: access.enabled && access.module.enabled,
            })) || [],
            usage: {
                sales: company._count?.sales || 0,
                products: company._count?.products || 0,
                customers: company._count?.customers || 0,
                suppliers: company._count?.suppliers || 0,
            },
            createdAt: company.createdAt,
            updatedAt: company.updatedAt,
        };
    }
    serializeModule(module) {
        return {
            id: module.id,
            key: module.key,
            moduleKey: module.key,
            name: module.name,
            description: module.description,
            enabled: module.enabled,
            locked: module.locked,
            createdAt: module.createdAt,
            updatedAt: module.updatedAt,
        };
    }
};
exports.PlatformAdminService = PlatformAdminService;
exports.PlatformAdminService = PlatformAdminService = PlatformAdminService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], PlatformAdminService);
//# sourceMappingURL=platform-admin.service.js.map
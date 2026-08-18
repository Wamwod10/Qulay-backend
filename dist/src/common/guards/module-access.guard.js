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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModuleAccessGuard = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const modules_decorator_1 = require("../decorators/modules.decorator");
const prisma_service_1 = require("../../database/prisma.service");
let ModuleAccessGuard = class ModuleAccessGuard {
    prisma;
    reflector;
    constructor(prisma, reflector = new core_1.Reflector()) {
        this.prisma = prisma;
        this.reflector = reflector;
    }
    async canActivate(context) {
        const moduleKeys = this.reflector.getAllAndOverride(modules_decorator_1.MODULES_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (!moduleKeys?.length) {
            return true;
        }
        const request = context.switchToHttp().getRequest();
        const user = request.user;
        if (user?.role === "SUPER_ADMIN") {
            return true;
        }
        const companyId = request.companyId;
        if (!companyId) {
            throw new common_1.ForbiddenException({ code: "TENANT_REQUIRED", message: "Kompaniya tanlanmagan." });
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
            return Boolean(module?.enabled && companyAccess?.enabled);
        });
        if (!allowed) {
            throw new common_1.ForbiddenException({ code: "MODULE_DISABLED", message: "Bo'lim o'chirilgan." });
        }
        return true;
    }
};
exports.ModuleAccessGuard = ModuleAccessGuard;
exports.ModuleAccessGuard = ModuleAccessGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        core_1.Reflector])
], ModuleAccessGuard);
//# sourceMappingURL=module-access.guard.js.map
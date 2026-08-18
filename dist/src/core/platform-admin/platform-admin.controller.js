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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlatformAdminController = void 0;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const super_admin_guard_1 = require("../../common/guards/super-admin.guard");
const platform_admin_service_1 = require("./platform-admin.service");
class UpdateStatusDto {
    status;
}
__decorate([
    (0, class_validator_1.IsIn)(["ACTIVE", "BLOCKED"]),
    __metadata("design:type", String)
], UpdateStatusDto.prototype, "status", void 0);
class UpdateEnabledDto {
    enabled;
}
__decorate([
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], UpdateEnabledDto.prototype, "enabled", void 0);
let PlatformAdminController = class PlatformAdminController {
    service;
    constructor(service) {
        this.service = service;
    }
    dashboard() {
        return this.service.dashboard();
    }
    users(query) {
        return this.service.listUsers(query);
    }
    user(userId) {
        return this.service.getUser(userId);
    }
    updateUserStatus(userId, dto, actorId, request) {
        return this.service.updateUserStatus(userId, dto.status, actorId, request.ip);
    }
    deleteUser(userId, actorId, request) {
        return this.service.deleteUser(userId, actorId, request.ip);
    }
    companies(query) {
        return this.service.listCompanies(query);
    }
    company(companyId) {
        return this.service.getCompany(companyId);
    }
    updateCompanyStatus(companyId, dto, actorId, request) {
        return this.service.updateCompanyStatus(companyId, dto.status, actorId, request.ip);
    }
    modules() {
        return this.service.getModules();
    }
    updateModule(moduleKey, dto, actorId, request) {
        return this.service.updateModule(moduleKey, dto.enabled, actorId, request.ip);
    }
    accountModules(accountId) {
        return this.service.getCompanyModules(accountId);
    }
    updateAccountModule(accountId, moduleKey, dto, actorId, request) {
        return this.service.updateCompanyModule(accountId, moduleKey, dto.enabled, actorId, request.ip);
    }
    auditLogs(query) {
        return this.service.auditLogs(query);
    }
};
exports.PlatformAdminController = PlatformAdminController;
__decorate([
    (0, common_1.Get)("dashboard"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], PlatformAdminController.prototype, "dashboard", null);
__decorate([
    (0, common_1.Get)("users"),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], PlatformAdminController.prototype, "users", null);
__decorate([
    (0, common_1.Get)("users/:userId"),
    __param(0, (0, common_1.Param)("userId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], PlatformAdminController.prototype, "user", null);
__decorate([
    (0, common_1.Patch)("users/:userId/status"),
    __param(0, (0, common_1.Param)("userId")),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)("id")),
    __param(3, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, UpdateStatusDto, String, Object]),
    __metadata("design:returntype", void 0)
], PlatformAdminController.prototype, "updateUserStatus", null);
__decorate([
    (0, common_1.Delete)("users/:userId"),
    __param(0, (0, common_1.Param)("userId")),
    __param(1, (0, current_user_decorator_1.CurrentUser)("id")),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", void 0)
], PlatformAdminController.prototype, "deleteUser", null);
__decorate([
    (0, common_1.Get)("companies"),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], PlatformAdminController.prototype, "companies", null);
__decorate([
    (0, common_1.Get)("companies/:companyId"),
    __param(0, (0, common_1.Param)("companyId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], PlatformAdminController.prototype, "company", null);
__decorate([
    (0, common_1.Patch)("companies/:companyId/status"),
    __param(0, (0, common_1.Param)("companyId")),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)("id")),
    __param(3, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, UpdateStatusDto, String, Object]),
    __metadata("design:returntype", void 0)
], PlatformAdminController.prototype, "updateCompanyStatus", null);
__decorate([
    (0, common_1.Get)("modules"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], PlatformAdminController.prototype, "modules", null);
__decorate([
    (0, common_1.Patch)("modules/:moduleKey"),
    __param(0, (0, common_1.Param)("moduleKey")),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, current_user_decorator_1.CurrentUser)("id")),
    __param(3, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, UpdateEnabledDto, String, Object]),
    __metadata("design:returntype", void 0)
], PlatformAdminController.prototype, "updateModule", null);
__decorate([
    (0, common_1.Get)("accounts/:accountId/modules"),
    __param(0, (0, common_1.Param)("accountId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], PlatformAdminController.prototype, "accountModules", null);
__decorate([
    (0, common_1.Patch)("accounts/:accountId/modules/:moduleKey"),
    __param(0, (0, common_1.Param)("accountId")),
    __param(1, (0, common_1.Param)("moduleKey")),
    __param(2, (0, common_1.Body)()),
    __param(3, (0, current_user_decorator_1.CurrentUser)("id")),
    __param(4, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, UpdateEnabledDto, String, Object]),
    __metadata("design:returntype", void 0)
], PlatformAdminController.prototype, "updateAccountModule", null);
__decorate([
    (0, common_1.Get)("audit-logs"),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], PlatformAdminController.prototype, "auditLogs", null);
exports.PlatformAdminController = PlatformAdminController = __decorate([
    (0, common_1.UseGuards)(super_admin_guard_1.SuperAdminGuard),
    (0, common_1.Controller)("superadmin"),
    __metadata("design:paramtypes", [platform_admin_service_1.PlatformAdminService])
], PlatformAdminController);
//# sourceMappingURL=platform-admin.controller.js.map
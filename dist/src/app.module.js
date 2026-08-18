"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const core_1 = require("@nestjs/core");
const jwt_1 = require("@nestjs/jwt");
const database_module_1 = require("./database/database.module");
const jwt_auth_guard_1 = require("./common/guards/jwt-auth.guard");
const roles_guard_1 = require("./common/guards/roles.guard");
const permissions_guard_1 = require("./common/guards/permissions.guard");
const module_access_guard_1 = require("./common/guards/module-access.guard");
const auth_module_1 = require("./core/auth/auth.module");
const platform_admin_module_1 = require("./core/platform-admin/platform-admin.module");
const business_module_1 = require("./modules/business/business.module");
const health_module_1 = require("./health/health.module");
const env_validation_1 = require("./config/env.validation");
const app_config_1 = require("./config/app.config");
const cors_config_1 = require("./config/cors.config");
const database_config_1 = require("./config/database.config");
const jwt_config_1 = require("./config/jwt.config");
const storage_config_1 = require("./config/storage.config");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                load: [app_config_1.default, cors_config_1.default, database_config_1.default, jwt_config_1.default, storage_config_1.default],
                validate: env_validation_1.validateEnv,
            }),
            jwt_1.JwtModule.register({ global: true }),
            database_module_1.DatabaseModule,
            auth_module_1.AuthModule,
            platform_admin_module_1.PlatformAdminModule,
            business_module_1.BusinessModule,
            health_module_1.HealthModule,
        ],
        providers: [
            {
                provide: core_1.APP_GUARD,
                useClass: jwt_auth_guard_1.JwtAuthGuard,
            },
            {
                provide: core_1.APP_GUARD,
                useClass: roles_guard_1.RolesGuard,
            },
            {
                provide: core_1.APP_GUARD,
                useClass: permissions_guard_1.PermissionsGuard,
            },
            {
                provide: core_1.APP_GUARD,
                useClass: module_access_guard_1.ModuleAccessGuard,
            },
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map
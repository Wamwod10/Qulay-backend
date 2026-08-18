import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";

import { DatabaseModule } from "./database/database.module";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { RolesGuard } from "./common/guards/roles.guard";
import { PermissionsGuard } from "./common/guards/permissions.guard";
import { ModuleAccessGuard } from "./common/guards/module-access.guard";
import { AuthModule } from "./core/auth/auth.module";
import { PlatformAdminModule } from "./core/platform-admin/platform-admin.module";
import { BusinessModule } from "./modules/business/business.module";
import { HealthModule } from "./health/health.module";
import { validateEnv } from "./config/env.validation";
import appConfig from "./config/app.config";
import corsConfig from "./config/cors.config";
import databaseConfig from "./config/database.config";
import jwtConfig from "./config/jwt.config";
import storageConfig from "./config/storage.config";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, corsConfig, databaseConfig, jwtConfig, storageConfig],
      validate: validateEnv,
    }),
    JwtModule.register({ global: true }),
    DatabaseModule,
    AuthModule,
    PlatformAdminModule,
    BusinessModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ModuleAccessGuard,
    },
  ],
})
export class AppModule {}

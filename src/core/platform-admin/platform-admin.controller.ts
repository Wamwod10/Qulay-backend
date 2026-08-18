import { Body, Controller, Delete, Get, Param, Patch, Query, Req, UseGuards } from "@nestjs/common";
import { IsBoolean, IsIn } from "class-validator";

import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { SuperAdminGuard } from "../../common/guards/super-admin.guard";
import { PlatformAdminService } from "./platform-admin.service";

class UpdateStatusDto {
  @IsIn(["ACTIVE", "BLOCKED"])
  status!: "ACTIVE" | "BLOCKED";
}

class UpdateEnabledDto {
  @IsBoolean()
  enabled!: boolean;
}

@UseGuards(SuperAdminGuard)
@Controller("superadmin")
export class PlatformAdminController {
  constructor(private readonly service: PlatformAdminService) {}

  @Get("dashboard")
  dashboard() {
    return this.service.dashboard();
  }

  @Get("users")
  users(@Query() query: Record<string, string | undefined>) {
    return this.service.listUsers(query);
  }

  @Get("users/:userId")
  user(@Param("userId") userId: string) {
    return this.service.getUser(userId);
  }

  @Patch("users/:userId/status")
  updateUserStatus(
    @Param("userId") userId: string,
    @Body() dto: UpdateStatusDto,
    @CurrentUser("id") actorId: string,
    @Req() request: any,
  ) {
    return this.service.updateUserStatus(userId, dto.status, actorId, request.ip);
  }

  @Delete("users/:userId")
  deleteUser(@Param("userId") userId: string, @CurrentUser("id") actorId: string, @Req() request: any) {
    return this.service.deleteUser(userId, actorId, request.ip);
  }

  @Get("companies")
  companies(@Query() query: Record<string, string | undefined>) {
    return this.service.listCompanies(query);
  }

  @Get("companies/:companyId")
  company(@Param("companyId") companyId: string) {
    return this.service.getCompany(companyId);
  }

  @Patch("companies/:companyId/status")
  updateCompanyStatus(
    @Param("companyId") companyId: string,
    @Body() dto: UpdateStatusDto,
    @CurrentUser("id") actorId: string,
    @Req() request: any,
  ) {
    return this.service.updateCompanyStatus(companyId, dto.status, actorId, request.ip);
  }

  @Get("modules")
  modules() {
    return this.service.getModules();
  }

  @Patch("modules/:moduleKey")
  updateModule(
    @Param("moduleKey") moduleKey: string,
    @Body() dto: UpdateEnabledDto,
    @CurrentUser("id") actorId: string,
    @Req() request: any,
  ) {
    return this.service.updateModule(moduleKey, dto.enabled, actorId, request.ip);
  }

  @Get("accounts/:accountId/modules")
  accountModules(@Param("accountId") accountId: string) {
    return this.service.getCompanyModules(accountId);
  }

  @Patch("accounts/:accountId/modules/:moduleKey")
  updateAccountModule(
    @Param("accountId") accountId: string,
    @Param("moduleKey") moduleKey: string,
    @Body() dto: UpdateEnabledDto,
    @CurrentUser("id") actorId: string,
    @Req() request: any,
  ) {
    return this.service.updateCompanyModule(accountId, moduleKey, dto.enabled, actorId, request.ip);
  }

  @Get("audit-logs")
  auditLogs(@Query() query: Record<string, string | undefined>) {
    return this.service.auditLogs(query);
  }
}

import { Injectable, ServiceUnavailableException } from "@nestjs/common";

import { PrismaHealthService } from "../database/prisma-health.service";

@Injectable()
export class HealthService {
  constructor(private readonly prismaHealth: PrismaHealthService) {}

  async check() {
    try {
      await this.prismaHealth.check();
      return {
        status: "ok",
        database: "ok",
        timestamp: new Date().toISOString(),
      };
    } catch {
      throw new ServiceUnavailableException({
        code: "DATABASE_UNAVAILABLE",
        message: "Database health check muvaffaqiyatsiz.",
      });
    }
  }
}

import { Injectable } from "@nestjs/common";

import { PrismaService } from "./prisma.service";

@Injectable()
export class PrismaHealthService {
  constructor(private readonly prisma: PrismaService) {}

  async check() {
    await this.prisma.$queryRaw`SELECT 1`;

    return {
      database: "ok",
    };
  }
}

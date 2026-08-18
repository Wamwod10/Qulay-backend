import { Global, Module } from "@nestjs/common";

import { PrismaService } from "./prisma.service";
import { PrismaHealthService } from "./prisma-health.service";

@Global()
@Module({
  providers: [PrismaService, PrismaHealthService],
  exports: [PrismaService, PrismaHealthService],
})
export class DatabaseModule {}

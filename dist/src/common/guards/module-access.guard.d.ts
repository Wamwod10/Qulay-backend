import { CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PrismaService } from "../../database/prisma.service";
export declare class ModuleAccessGuard implements CanActivate {
    private readonly prisma;
    private readonly reflector;
    constructor(prisma: PrismaService, reflector?: Reflector);
    canActivate(context: ExecutionContext): Promise<boolean>;
}

import { CanActivate, ExecutionContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../../database/prisma.service";
export declare class JwtAuthGuard implements CanActivate {
    private readonly jwt;
    private readonly config;
    private readonly prisma;
    private readonly reflector;
    private readonly logger;
    constructor(jwt: JwtService, config: ConfigService, prisma: PrismaService, reflector?: Reflector);
    canActivate(context: ExecutionContext): Promise<boolean>;
}

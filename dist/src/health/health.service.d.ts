import { PrismaHealthService } from "../database/prisma-health.service";
export declare class HealthService {
    private readonly prismaHealth;
    constructor(prismaHealth: PrismaHealthService);
    check(): Promise<{
        status: string;
        database: string;
        timestamp: string;
    }>;
}

import { PrismaService } from "./prisma.service";
export declare class PrismaHealthService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    check(): Promise<{
        database: string;
    }>;
}

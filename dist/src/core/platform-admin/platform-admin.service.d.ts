import { PrismaService } from "../../database/prisma.service";
export declare class PlatformAdminService {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    dashboard(): Promise<{
        stats: {
            users: any;
            totalUsers: any;
            activeUsers: any;
            blockedUsers: any;
            newUsersToday: any;
            companies: any;
            totalCompanies: any;
            activeCompanies: any;
        };
        recentRegistrations: any;
        modules: any;
        recentActivity: any;
    }>;
    listUsers(query: Record<string, string | undefined>): Promise<{
        users: any;
        meta: {
            page: number;
            limit: number;
            total: number;
            totalPages: number;
        };
    }>;
    getUser(userId: string): Promise<{
        modules: any;
        id: any;
        fullName: any;
        name: any;
        email: any;
        phone: any;
        role: any;
        status: any;
        companyId: any;
        businessId: any;
        accountId: any;
        companyName: any;
        businessName: any;
        lastActiveAt: any;
        createdAt: any;
        updatedAt: any;
    }>;
    updateUserStatus(userId: string, status: "ACTIVE" | "BLOCKED", actorId: string, ip?: string): Promise<{
        id: any;
        fullName: any;
        name: any;
        email: any;
        phone: any;
        role: any;
        status: any;
        companyId: any;
        businessId: any;
        accountId: any;
        companyName: any;
        businessName: any;
        lastActiveAt: any;
        createdAt: any;
        updatedAt: any;
    }>;
    deleteUser(userId: string, actorId: string, ip?: string): Promise<{
        deleted: boolean;
        softDelete: boolean;
    }>;
    listCompanies(query: Record<string, string | undefined>): Promise<{
        companies: any;
        meta: {
            page: number;
            limit: number;
            total: number;
            totalPages: number;
        };
    }>;
    getCompany(companyId: string): Promise<{
        users: any;
        recentSales: any;
        activity: any;
        id: any;
        name: any;
        businessName: any;
        businessType: any;
        phone: any;
        email: any;
        address: any;
        country: any;
        currency: any;
        status: any;
        ownerUserId: any;
        owner: {
            id: any;
            fullName: any;
            email: any;
            phone: any;
        } | null;
        usersCount: any;
        modules: any;
        usage: {
            sales: any;
            products: any;
            customers: any;
            suppliers: any;
        };
        createdAt: any;
        updatedAt: any;
    }>;
    updateCompanyStatus(companyId: string, status: "ACTIVE" | "BLOCKED", actorId: string, ip?: string): Promise<{
        id: any;
        name: any;
        businessName: any;
        businessType: any;
        phone: any;
        email: any;
        address: any;
        country: any;
        currency: any;
        status: any;
        ownerUserId: any;
        owner: {
            id: any;
            fullName: any;
            email: any;
            phone: any;
        } | null;
        usersCount: any;
        modules: any;
        usage: {
            sales: any;
            products: any;
            customers: any;
            suppliers: any;
        };
        createdAt: any;
        updatedAt: any;
    }>;
    getModules(): Promise<{
        modules: any;
    }>;
    updateModule(moduleKey: string, enabled: boolean, actorId: string, ip?: string): Promise<{
        id: any;
        key: any;
        moduleKey: any;
        name: any;
        description: any;
        enabled: any;
        locked: any;
        createdAt: any;
        updatedAt: any;
    }>;
    getCompanyModules(companyId: string): Promise<{
        modules: any;
    }>;
    updateCompanyModule(companyId: string, moduleKey: string, enabled: boolean, actorId: string, ip?: string): Promise<{
        key: any;
        moduleKey: any;
        enabled: any;
        globalEnabled: any;
        effectiveEnabled: any;
    }>;
    auditLogs(query: Record<string, string | undefined>): Promise<{
        logs: any;
        auditLogs: any;
        meta: {
            page: number;
            limit: number;
            total: number;
            totalPages: number;
        };
    }>;
    ensureCompanyModuleAccess(companyId: string): Promise<void>;
    ensureModules(): Promise<any[]>;
    audit(data: {
        companyId?: string | null;
        actorUserId?: string | null;
        action: string;
        targetType: string;
        targetId: string;
        metadata?: Record<string, unknown>;
        ip?: string;
    }): Promise<any>;
    private serializeUser;
    private serializeCompany;
    private serializeModule;
}

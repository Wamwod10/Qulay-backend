import { PlatformAdminService } from "./platform-admin.service";
declare class UpdateStatusDto {
    status: "ACTIVE" | "BLOCKED";
}
declare class UpdateEnabledDto {
    enabled: boolean;
}
export declare class PlatformAdminController {
    private readonly service;
    constructor(service: PlatformAdminService);
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
    users(query: Record<string, string | undefined>): Promise<{
        users: any;
        meta: {
            page: number;
            limit: number;
            total: number;
            totalPages: number;
        };
    }>;
    user(userId: string): Promise<{
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
    updateUserStatus(userId: string, dto: UpdateStatusDto, actorId: string, request: any): Promise<{
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
    deleteUser(userId: string, actorId: string, request: any): Promise<{
        deleted: boolean;
        softDelete: boolean;
    }>;
    companies(query: Record<string, string | undefined>): Promise<{
        companies: any;
        meta: {
            page: number;
            limit: number;
            total: number;
            totalPages: number;
        };
    }>;
    company(companyId: string): Promise<{
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
    updateCompanyStatus(companyId: string, dto: UpdateStatusDto, actorId: string, request: any): Promise<{
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
    modules(): Promise<{
        modules: any;
    }>;
    updateModule(moduleKey: string, dto: UpdateEnabledDto, actorId: string, request: any): Promise<{
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
    accountModules(accountId: string): Promise<{
        modules: any;
    }>;
    updateAccountModule(accountId: string, moduleKey: string, dto: UpdateEnabledDto, actorId: string, request: any): Promise<{
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
}
export {};

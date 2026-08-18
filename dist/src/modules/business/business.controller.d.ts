import { BusinessService } from "./business.service";
export declare class ContextController {
    private readonly service;
    constructor(service: BusinessService);
    context(user: any, companyId: string): Promise<{
        user: any;
        company: any;
    }>;
}
export declare class ProductsController {
    private readonly service;
    constructor(service: BusinessService);
    list(companyId: string, query: Record<string, string | undefined>): Promise<{
        products: any;
        data: any;
        meta: {
            page: number;
            limit: number;
            total: number;
            totalPages: number;
        };
    }>;
    create(companyId: string, body: any): Promise<any>;
    get(companyId: string, id: string): Promise<any>;
    update(companyId: string, id: string, body: any): Promise<any>;
    status(companyId: string, id: string, body: any): Promise<any>;
    stock(companyId: string, id: string, body: any): Promise<any>;
    prices(companyId: string, id: string, body: any): Promise<any>;
    duplicate(companyId: string, id: string): Promise<any>;
    delete(companyId: string, id: string): Promise<{
        deleted: boolean;
        softDelete: boolean;
    }>;
}
export declare class WarehousesController {
    private readonly service;
    constructor(service: BusinessService);
    list(companyId: string): Promise<{
        warehouses: any;
        data: any;
    }>;
    create(companyId: string, body: any): Promise<any>;
}
export declare class InventoryController {
    private readonly service;
    constructor(service: BusinessService);
    stock(companyId: string, query: Record<string, string | undefined>): Promise<{
        stock: any;
        data: any;
    }>;
    movements(companyId: string, query: Record<string, string | undefined>): Promise<{
        movements: any;
        data: any;
    }>;
    stockIn(companyId: string, body: any): Promise<any>;
    stockOut(companyId: string, body: any): Promise<any>;
    transfer(companyId: string, body: any): Promise<any>;
}
export declare class SuppliersController {
    private readonly service;
    constructor(service: BusinessService);
    list(companyId: string, query: Record<string, string | undefined>): Promise<{
        suppliers: any;
        data: any;
    }>;
    create(companyId: string, body: any): Promise<any>;
    get(companyId: string, id: string): Promise<any>;
    update(companyId: string, id: string, body: any): Promise<any>;
    delete(companyId: string, id: string): Promise<{
        deleted: boolean;
        softDelete: boolean;
    }>;
}
export declare class PurchasesController {
    private readonly service;
    constructor(service: BusinessService);
    list(companyId: string, query: Record<string, string | undefined>): Promise<{
        purchases: any;
        data: any;
    }>;
    create(companyId: string, body: any): Promise<any>;
    get(companyId: string, id: string): Promise<any>;
    update(companyId: string, id: string, body: any): Promise<any>;
    receive(companyId: string, id: string, body: any): Promise<any>;
    payment(companyId: string, id: string, body: any): Promise<any>;
    cancel(companyId: string, id: string): Promise<any>;
}
export declare class SalesController {
    private readonly service;
    constructor(service: BusinessService);
    list(companyId: string, query: Record<string, string | undefined>): Promise<{
        sales: any;
        data: any;
    }>;
    hold(companyId: string, body: any): Promise<any>;
    complete(companyId: string, body: any, request: any): Promise<any>;
    get(companyId: string, id: string): Promise<any>;
    cancel(companyId: string, id: string, body: any): Promise<any>;
    returnItems(companyId: string, id: string, body: any): Promise<any>;
}
export declare class CustomersController {
    private readonly service;
    constructor(service: BusinessService);
    list(companyId: string): Promise<{
        customers: any;
        data: any;
    }>;
    create(companyId: string, body: any): Promise<any>;
    get(companyId: string, id: string): Promise<any>;
    update(companyId: string, id: string, body: any): Promise<any>;
    payment(companyId: string, id: string, body: any): Promise<any>;
    delete(companyId: string, id: string): Promise<{
        deleted: boolean;
        softDelete: boolean;
    }>;
}
export declare class AgentsController {
    private readonly service;
    constructor(service: BusinessService);
    list(companyId: string): Promise<{
        agents: any;
        data: any;
    }>;
    create(companyId: string, body: any): Promise<any>;
    get(companyId: string, id: string): Promise<any>;
    update(companyId: string, id: string, body: any): Promise<any>;
    delete(companyId: string, id: string): Promise<{
        deleted: boolean;
        softDelete: boolean;
    }>;
}
export declare class ManufacturingController {
    private readonly service;
    constructor(service: BusinessService);
    boms(companyId: string): Promise<{
        boms: any;
        data: any;
    }>;
    createBom(companyId: string, body: any): Promise<any>;
    getBom(companyId: string, id: string): Promise<any>;
    updateBom(companyId: string, id: string, body: any): Promise<any>;
    deleteBom(companyId: string, id: string): Promise<{
        deleted: boolean;
        softDelete: boolean;
    }>;
    orders(companyId: string): Promise<{
        orders: any;
        productionOrders: any;
        data: any;
    }>;
    createOrder(companyId: string, body: any): Promise<any>;
    order(companyId: string, id: string): Promise<any>;
    start(companyId: string, id: string, body: any): Promise<any>;
    complete(companyId: string, id: string, body: any): Promise<any>;
    cancel(companyId: string, id: string): Promise<any>;
}
export declare class FinanceController {
    private readonly service;
    constructor(service: BusinessService);
    transactions(companyId: string, query: Record<string, string | undefined>): Promise<{
        transactions: any;
        data: any;
    }>;
    create(companyId: string, body: any): Promise<any>;
    cashboxes(companyId: string): Promise<{
        cashboxes: any;
        data: any;
    }>;
}
export declare class EmployeesController {
    private readonly service;
    constructor(service: BusinessService);
    list(companyId: string): Promise<{
        employees: any;
        data: any;
    }>;
    create(companyId: string, body: any): Promise<any>;
    payroll(companyId: string): Promise<{
        payrolls: any;
        data: any;
    }>;
    createPayroll(companyId: string, body: any): Promise<any>;
    payPayroll(companyId: string, id: string, body: any): Promise<any>;
    update(companyId: string, id: string, body: any): Promise<any>;
    delete(companyId: string, id: string): Promise<{
        deleted: boolean;
        softDelete: boolean;
    }>;
}
export declare class ReportsController {
    private readonly service;
    constructor(service: BusinessService);
    reports(companyId: string): Promise<{
        sales: {
            count: any;
            total: number;
            paid: number;
            debt: number;
        };
        inventory: {
            products: any;
        };
        crm: {
            customers: any;
            suppliers: any;
        };
        finance: {
            income: number;
            outcome: number;
            net: number;
        };
        manufacturing: {
            orders: any;
        };
        hr: {
            employees: any;
        };
    }>;
    reportType(companyId: string): Promise<{
        sales: {
            count: any;
            total: number;
            paid: number;
            debt: number;
        };
        inventory: {
            products: any;
        };
        crm: {
            customers: any;
            suppliers: any;
        };
        finance: {
            income: number;
            outcome: number;
            net: number;
        };
        manufacturing: {
            orders: any;
        };
        hr: {
            employees: any;
        };
    }>;
}
export declare class DashboardController {
    private readonly service;
    constructor(service: BusinessService);
    dashboard(companyId: string): Promise<{
        sales: {
            count: any;
            total: number;
            paid: number;
            debt: number;
        };
        inventory: {
            products: any;
        };
        crm: {
            customers: any;
            suppliers: any;
        };
        finance: {
            income: number;
            outcome: number;
            net: number;
        };
        manufacturing: {
            orders: any;
        };
        hr: {
            employees: any;
        };
    }>;
}
export declare class SettingsController {
    private readonly service;
    constructor(service: BusinessService);
    get(companyId: string, userId: string): Promise<{
        company: {
            [k: string]: any;
        };
        user: {
            [k: string]: any;
        };
    }>;
    update(companyId: string, userId: string, body: any): Promise<{
        company: {
            [k: string]: any;
        };
        user: {
            [k: string]: any;
        };
    }>;
}

import { PrismaService } from "../../database/prisma.service";
export declare class BusinessService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    requireCompany(companyId?: string | null): string;
    currentContext(user: any, companyId?: string | null): Promise<{
        user: any;
        company: any;
    }>;
    listProducts(companyId: string, query: Record<string, string | undefined>): Promise<{
        products: any;
        data: any;
        meta: {
            page: number;
            limit: number;
            total: number;
            totalPages: number;
        };
    }>;
    getProduct(companyId: string, id: string): Promise<any>;
    createProduct(companyId: string, body: any): Promise<any>;
    updateProduct(companyId: string, id: string, body: any): Promise<any>;
    changeProductStatus(companyId: string, id: string, status: "ACTIVE" | "INACTIVE" | "ARCHIVED"): Promise<any>;
    deleteProduct(companyId: string, id: string): Promise<{
        deleted: boolean;
        softDelete: boolean;
    }>;
    duplicateProduct(companyId: string, id: string): Promise<any>;
    adjustProductStock(companyId: string, id: string, body: any): Promise<any>;
    updateProductPrices(companyId: string, id: string, body: any): Promise<any>;
    listWarehouses(companyId: string): Promise<{
        warehouses: any;
        data: any;
    }>;
    createWarehouse(companyId: string, body: any): Promise<any>;
    listStock(companyId: string, query: Record<string, string | undefined>): Promise<{
        stock: any;
        data: any;
    }>;
    stockIn(companyId: string, body: any): Promise<any>;
    stockOut(companyId: string, body: any): Promise<any>;
    transferStock(companyId: string, body: any): Promise<any>;
    listMovements(companyId: string, query: Record<string, string | undefined>): Promise<{
        movements: any;
        data: any;
    }>;
    listSuppliers(companyId: string, query: Record<string, string | undefined>): Promise<{
        suppliers: any;
        data: any;
    }>;
    getSupplier(companyId: string, id: string): Promise<any>;
    createSupplier(companyId: string, body: any): Promise<any>;
    updateSupplier(companyId: string, id: string, body: any): Promise<any>;
    deleteSupplier(companyId: string, id: string): Promise<{
        deleted: boolean;
        softDelete: boolean;
    }>;
    listPurchases(companyId: string, query: Record<string, string | undefined>): Promise<{
        purchases: any;
        data: any;
    }>;
    getPurchase(companyId: string, id: string): Promise<any>;
    createPurchase(companyId: string, body: any): Promise<any>;
    updatePurchase(companyId: string, id: string, body: any): Promise<any>;
    receivePurchase(companyId: string, id: string, body: any): Promise<any>;
    payPurchase(companyId: string, id: string, body: any): Promise<any>;
    cancelPurchase(companyId: string, id: string): Promise<any>;
    listSales(companyId: string, query: Record<string, string | undefined>): Promise<{
        sales: any;
        data: any;
    }>;
    getSale(companyId: string, id: string): Promise<any>;
    holdSale(companyId: string, body: any): Promise<any>;
    completeSale(companyId: string, body: any, idempotencyKey?: string): Promise<any>;
    cancelSale(companyId: string, id: string, body: any): Promise<any>;
    returnSale(companyId: string, id: string, body: any): Promise<any>;
    listCustomers(companyId: string): Promise<{
        customers: any;
        data: any;
    }>;
    getCustomer(companyId: string, id: string): Promise<any>;
    createCustomer(companyId: string, body: any): Promise<any>;
    updateCustomer(companyId: string, id: string, body: any): Promise<any>;
    deleteCustomer(companyId: string, id: string): Promise<{
        deleted: boolean;
        softDelete: boolean;
    }>;
    receiveCustomerPayment(companyId: string, id: string, body: any): Promise<any>;
    listAgents(companyId: string): Promise<{
        agents: any;
        data: any;
    }>;
    getAgent(companyId: string, id: string): Promise<any>;
    createAgent(companyId: string, body: any): Promise<any>;
    updateAgent(companyId: string, id: string, body: any): Promise<any>;
    deleteAgent(companyId: string, id: string): Promise<{
        deleted: boolean;
        softDelete: boolean;
    }>;
    listBoms(companyId: string): Promise<{
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
    listProductionOrders(companyId: string): Promise<{
        orders: any;
        productionOrders: any;
        data: any;
    }>;
    createProductionOrder(companyId: string, body: any): Promise<any>;
    startProduction(companyId: string, id: string, body: any): Promise<any>;
    completeProduction(companyId: string, id: string, body: any): Promise<any>;
    cancelProduction(companyId: string, id: string): Promise<any>;
    getProductionOrder(companyId: string, id: string): Promise<any>;
    listFinance(companyId: string, query: Record<string, string | undefined>): Promise<{
        transactions: any;
        data: any;
    }>;
    createFinance(companyId: string, body: any): Promise<any>;
    listCashboxes(companyId: string): Promise<{
        cashboxes: any;
        data: any;
    }>;
    listEmployees(companyId: string): Promise<{
        employees: any;
        data: any;
    }>;
    createEmployee(companyId: string, body: any): Promise<any>;
    updateEmployee(companyId: string, id: string, body: any): Promise<any>;
    deleteEmployee(companyId: string, id: string): Promise<{
        deleted: boolean;
        softDelete: boolean;
    }>;
    createPayroll(companyId: string, body: any): Promise<any>;
    payPayroll(companyId: string, id: string, body: any): Promise<any>;
    listPayroll(companyId: string): Promise<{
        payrolls: any;
        data: any;
    }>;
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
    getSettings(companyId: string, userId?: string): Promise<{
        company: {
            [k: string]: any;
        };
        user: {
            [k: string]: any;
        };
    }>;
    updateSettings(companyId: string, body: any, userId?: string): Promise<{
        company: {
            [k: string]: any;
        };
        user: {
            [k: string]: any;
        };
    }>;
    private changeStock;
    private adjustStockDelta;
    private ensureStockItem;
    private requireWarehouse;
    private validateProductIds;
    private validateFinanceReferences;
    private refreshProductStock;
    private ensureDefaultWarehouse;
    private ensureDefaultCashbox;
    private createFinanceTx;
    private generateSku;
    private generateNumber;
    private normalizePurchaseItems;
    private normalizeSalePayload;
    private saleCreateData;
    private saleUpdateData;
    private salePaymentCreateData;
    private requireEmployee;
    private productDto;
    private stockDto;
    private movementDto;
    private supplierDto;
    private purchaseDto;
    private saleDto;
    private customerDto;
    private agentDto;
    private bomDto;
    private productionOrderDto;
    private financeDto;
    private cashboxDto;
    private employeeDto;
    private payrollDto;
}

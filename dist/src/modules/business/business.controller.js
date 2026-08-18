"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsController = exports.DashboardController = exports.ReportsController = exports.EmployeesController = exports.FinanceController = exports.ManufacturingController = exports.AgentsController = exports.CustomersController = exports.SalesController = exports.PurchasesController = exports.SuppliersController = exports.InventoryController = exports.WarehousesController = exports.ProductsController = exports.ContextController = void 0;
const common_1 = require("@nestjs/common");
const current_company_decorator_1 = require("../../common/decorators/current-company.decorator");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const modules_decorator_1 = require("../../common/decorators/modules.decorator");
const business_service_1 = require("./business.service");
let ContextController = class ContextController {
    service;
    constructor(service) {
        this.service = service;
    }
    context(user, companyId) {
        return this.service.currentContext(user, companyId);
    }
};
exports.ContextController = ContextController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, current_company_decorator_1.CurrentCompany)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ContextController.prototype, "context", null);
exports.ContextController = ContextController = __decorate([
    (0, common_1.Controller)("context"),
    __metadata("design:paramtypes", [business_service_1.BusinessService])
], ContextController);
let ProductsController = class ProductsController {
    service;
    constructor(service) {
        this.service = service;
    }
    list(companyId, query) {
        return this.service.listProducts(companyId, query);
    }
    create(companyId, body) {
        return this.service.createProduct(companyId, body);
    }
    get(companyId, id) {
        return this.service.getProduct(companyId, id);
    }
    update(companyId, id, body) {
        return this.service.updateProduct(companyId, id, body);
    }
    status(companyId, id, body) {
        return this.service.changeProductStatus(companyId, id, body.status);
    }
    stock(companyId, id, body) {
        return this.service.adjustProductStock(companyId, id, body);
    }
    prices(companyId, id, body) {
        return this.service.updateProductPrices(companyId, id, body);
    }
    duplicate(companyId, id) {
        return this.service.duplicateProduct(companyId, id);
    }
    delete(companyId, id) {
        return this.service.deleteProduct(companyId, id);
    }
};
exports.ProductsController = ProductsController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(":id"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "get", null);
__decorate([
    (0, common_1.Patch)(":id"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "update", null);
__decorate([
    (0, common_1.Patch)(":id/status"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "status", null);
__decorate([
    (0, common_1.Patch)(":id/stock"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "stock", null);
__decorate([
    (0, common_1.Patch)(":id/prices"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "prices", null);
__decorate([
    (0, common_1.Post)(":id/duplicate"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "duplicate", null);
__decorate([
    (0, common_1.Delete)(":id"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], ProductsController.prototype, "delete", null);
exports.ProductsController = ProductsController = __decorate([
    (0, modules_decorator_1.RequireModules)("products"),
    (0, common_1.Controller)("products"),
    __metadata("design:paramtypes", [business_service_1.BusinessService])
], ProductsController);
let WarehousesController = class WarehousesController {
    service;
    constructor(service) {
        this.service = service;
    }
    list(companyId) {
        return this.service.listWarehouses(companyId);
    }
    create(companyId, body) {
        return this.service.createWarehouse(companyId, body);
    }
};
exports.WarehousesController = WarehousesController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], WarehousesController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], WarehousesController.prototype, "create", null);
exports.WarehousesController = WarehousesController = __decorate([
    (0, modules_decorator_1.RequireModules)("warehouse"),
    (0, common_1.Controller)("warehouses"),
    __metadata("design:paramtypes", [business_service_1.BusinessService])
], WarehousesController);
let InventoryController = class InventoryController {
    service;
    constructor(service) {
        this.service = service;
    }
    stock(companyId, query) {
        return this.service.listStock(companyId, query);
    }
    movements(companyId, query) {
        return this.service.listMovements(companyId, query);
    }
    stockIn(companyId, body) {
        return this.service.stockIn(companyId, body);
    }
    stockOut(companyId, body) {
        return this.service.stockOut(companyId, body);
    }
    transfer(companyId, body) {
        return this.service.transferStock(companyId, body);
    }
};
exports.InventoryController = InventoryController;
__decorate([
    (0, common_1.Get)("stock"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], InventoryController.prototype, "stock", null);
__decorate([
    (0, common_1.Get)("movements"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], InventoryController.prototype, "movements", null);
__decorate([
    (0, common_1.Post)("stock/in"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], InventoryController.prototype, "stockIn", null);
__decorate([
    (0, common_1.Post)("stock/out"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], InventoryController.prototype, "stockOut", null);
__decorate([
    (0, common_1.Post)("stock/transfer"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], InventoryController.prototype, "transfer", null);
exports.InventoryController = InventoryController = __decorate([
    (0, modules_decorator_1.RequireModules)("warehouse"),
    (0, common_1.Controller)("inventory"),
    __metadata("design:paramtypes", [business_service_1.BusinessService])
], InventoryController);
let SuppliersController = class SuppliersController {
    service;
    constructor(service) {
        this.service = service;
    }
    list(companyId, query) {
        return this.service.listSuppliers(companyId, query);
    }
    create(companyId, body) {
        return this.service.createSupplier(companyId, body);
    }
    get(companyId, id) {
        return this.service.getSupplier(companyId, id);
    }
    update(companyId, id, body) {
        return this.service.updateSupplier(companyId, id, body);
    }
    delete(companyId, id) {
        return this.service.deleteSupplier(companyId, id);
    }
};
exports.SuppliersController = SuppliersController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], SuppliersController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], SuppliersController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(":id"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], SuppliersController.prototype, "get", null);
__decorate([
    (0, common_1.Patch)(":id"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", void 0)
], SuppliersController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(":id"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], SuppliersController.prototype, "delete", null);
exports.SuppliersController = SuppliersController = __decorate([
    (0, modules_decorator_1.RequireModules)("suppliers"),
    (0, common_1.Controller)("suppliers"),
    __metadata("design:paramtypes", [business_service_1.BusinessService])
], SuppliersController);
let PurchasesController = class PurchasesController {
    service;
    constructor(service) {
        this.service = service;
    }
    list(companyId, query) {
        return this.service.listPurchases(companyId, query);
    }
    create(companyId, body) {
        return this.service.createPurchase(companyId, body);
    }
    get(companyId, id) {
        return this.service.getPurchase(companyId, id);
    }
    update(companyId, id, body) {
        return this.service.updatePurchase(companyId, id, body);
    }
    receive(companyId, id, body) {
        return this.service.receivePurchase(companyId, id, body);
    }
    payment(companyId, id, body) {
        return this.service.payPurchase(companyId, id, body);
    }
    cancel(companyId, id) {
        return this.service.cancelPurchase(companyId, id);
    }
};
exports.PurchasesController = PurchasesController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], PurchasesController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], PurchasesController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(":id"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], PurchasesController.prototype, "get", null);
__decorate([
    (0, common_1.Patch)(":id"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", void 0)
], PurchasesController.prototype, "update", null);
__decorate([
    (0, common_1.Post)(":id/receive"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", void 0)
], PurchasesController.prototype, "receive", null);
__decorate([
    (0, common_1.Post)(":id/payment"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", void 0)
], PurchasesController.prototype, "payment", null);
__decorate([
    (0, common_1.Post)(":id/cancel"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], PurchasesController.prototype, "cancel", null);
exports.PurchasesController = PurchasesController = __decorate([
    (0, modules_decorator_1.RequireModules)("purchases"),
    (0, common_1.Controller)("purchases"),
    __metadata("design:paramtypes", [business_service_1.BusinessService])
], PurchasesController);
let SalesController = class SalesController {
    service;
    constructor(service) {
        this.service = service;
    }
    list(companyId, query) {
        return this.service.listSales(companyId, query);
    }
    hold(companyId, body) {
        return this.service.holdSale(companyId, body);
    }
    complete(companyId, body, request) {
        return this.service.completeSale(companyId, body, request.headers["idempotency-key"]);
    }
    get(companyId, id) {
        return this.service.getSale(companyId, id);
    }
    cancel(companyId, id, body) {
        return this.service.cancelSale(companyId, id, body || {});
    }
    returnItems(companyId, id, body) {
        return this.service.returnSale(companyId, id, body);
    }
};
exports.SalesController = SalesController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], SalesController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], SalesController.prototype, "hold", null);
__decorate([
    (0, common_1.Post)("complete"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", void 0)
], SalesController.prototype, "complete", null);
__decorate([
    (0, common_1.Get)(":id"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], SalesController.prototype, "get", null);
__decorate([
    (0, common_1.Post)(":id/cancel"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", void 0)
], SalesController.prototype, "cancel", null);
__decorate([
    (0, common_1.Post)(":id/return"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", void 0)
], SalesController.prototype, "returnItems", null);
exports.SalesController = SalesController = __decorate([
    (0, modules_decorator_1.RequireModules)("sales"),
    (0, common_1.Controller)("sales"),
    __metadata("design:paramtypes", [business_service_1.BusinessService])
], SalesController);
let CustomersController = class CustomersController {
    service;
    constructor(service) {
        this.service = service;
    }
    list(companyId) {
        return this.service.listCustomers(companyId);
    }
    create(companyId, body) {
        return this.service.createCustomer(companyId, body);
    }
    get(companyId, id) {
        return this.service.getCustomer(companyId, id);
    }
    update(companyId, id, body) {
        return this.service.updateCustomer(companyId, id, body);
    }
    payment(companyId, id, body) {
        return this.service.receiveCustomerPayment(companyId, id, body);
    }
    delete(companyId, id) {
        return this.service.deleteCustomer(companyId, id);
    }
};
exports.CustomersController = CustomersController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CustomersController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], CustomersController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(":id"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], CustomersController.prototype, "get", null);
__decorate([
    (0, common_1.Patch)(":id"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", void 0)
], CustomersController.prototype, "update", null);
__decorate([
    (0, common_1.Post)(":id/payment"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", void 0)
], CustomersController.prototype, "payment", null);
__decorate([
    (0, common_1.Delete)(":id"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], CustomersController.prototype, "delete", null);
exports.CustomersController = CustomersController = __decorate([
    (0, modules_decorator_1.RequireModules)("customers"),
    (0, common_1.Controller)("customers"),
    __metadata("design:paramtypes", [business_service_1.BusinessService])
], CustomersController);
let AgentsController = class AgentsController {
    service;
    constructor(service) {
        this.service = service;
    }
    list(companyId) {
        return this.service.listAgents(companyId);
    }
    create(companyId, body) {
        return this.service.createAgent(companyId, body);
    }
    get(companyId, id) {
        return this.service.getAgent(companyId, id);
    }
    update(companyId, id, body) {
        return this.service.updateAgent(companyId, id, body);
    }
    delete(companyId, id) {
        return this.service.deleteAgent(companyId, id);
    }
};
exports.AgentsController = AgentsController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AgentsController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], AgentsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(":id"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], AgentsController.prototype, "get", null);
__decorate([
    (0, common_1.Patch)(":id"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", void 0)
], AgentsController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(":id"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], AgentsController.prototype, "delete", null);
exports.AgentsController = AgentsController = __decorate([
    (0, modules_decorator_1.RequireModules)("agents"),
    (0, common_1.Controller)("agents"),
    __metadata("design:paramtypes", [business_service_1.BusinessService])
], AgentsController);
let ManufacturingController = class ManufacturingController {
    service;
    constructor(service) {
        this.service = service;
    }
    boms(companyId) {
        return this.service.listBoms(companyId);
    }
    createBom(companyId, body) {
        return this.service.createBom(companyId, body);
    }
    getBom(companyId, id) {
        return this.service.getBom(companyId, id);
    }
    updateBom(companyId, id, body) {
        return this.service.updateBom(companyId, id, body);
    }
    deleteBom(companyId, id) {
        return this.service.deleteBom(companyId, id);
    }
    orders(companyId) {
        return this.service.listProductionOrders(companyId);
    }
    createOrder(companyId, body) {
        return this.service.createProductionOrder(companyId, body);
    }
    order(companyId, id) {
        return this.service.getProductionOrder(companyId, id);
    }
    start(companyId, id, body) {
        return this.service.startProduction(companyId, id, body || {});
    }
    complete(companyId, id, body) {
        return this.service.completeProduction(companyId, id, body || {});
    }
    cancel(companyId, id) {
        return this.service.cancelProduction(companyId, id);
    }
};
exports.ManufacturingController = ManufacturingController;
__decorate([
    (0, common_1.Get)("boms"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ManufacturingController.prototype, "boms", null);
__decorate([
    (0, common_1.Post)("boms"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], ManufacturingController.prototype, "createBom", null);
__decorate([
    (0, common_1.Get)("boms/:id"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], ManufacturingController.prototype, "getBom", null);
__decorate([
    (0, common_1.Patch)("boms/:id"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", void 0)
], ManufacturingController.prototype, "updateBom", null);
__decorate([
    (0, common_1.Delete)("boms/:id"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], ManufacturingController.prototype, "deleteBom", null);
__decorate([
    (0, common_1.Get)("orders"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ManufacturingController.prototype, "orders", null);
__decorate([
    (0, common_1.Post)("orders"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], ManufacturingController.prototype, "createOrder", null);
__decorate([
    (0, common_1.Get)("orders/:id"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], ManufacturingController.prototype, "order", null);
__decorate([
    (0, common_1.Post)("orders/:id/start"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", void 0)
], ManufacturingController.prototype, "start", null);
__decorate([
    (0, common_1.Post)("orders/:id/complete"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", void 0)
], ManufacturingController.prototype, "complete", null);
__decorate([
    (0, common_1.Post)("orders/:id/cancel"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], ManufacturingController.prototype, "cancel", null);
exports.ManufacturingController = ManufacturingController = __decorate([
    (0, modules_decorator_1.RequireModules)("manufacturing"),
    (0, common_1.Controller)("manufacturing"),
    __metadata("design:paramtypes", [business_service_1.BusinessService])
], ManufacturingController);
let FinanceController = class FinanceController {
    service;
    constructor(service) {
        this.service = service;
    }
    transactions(companyId, query) {
        return this.service.listFinance(companyId, query);
    }
    create(companyId, body) {
        return this.service.createFinance(companyId, body);
    }
    cashboxes(companyId) {
        return this.service.listCashboxes(companyId);
    }
};
exports.FinanceController = FinanceController;
__decorate([
    (0, common_1.Get)("transactions"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], FinanceController.prototype, "transactions", null);
__decorate([
    (0, common_1.Post)("transactions"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], FinanceController.prototype, "create", null);
__decorate([
    (0, common_1.Get)("cashboxes"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], FinanceController.prototype, "cashboxes", null);
exports.FinanceController = FinanceController = __decorate([
    (0, modules_decorator_1.RequireModules)("finance"),
    (0, common_1.Controller)("finance"),
    __metadata("design:paramtypes", [business_service_1.BusinessService])
], FinanceController);
let EmployeesController = class EmployeesController {
    service;
    constructor(service) {
        this.service = service;
    }
    list(companyId) {
        return this.service.listEmployees(companyId);
    }
    create(companyId, body) {
        return this.service.createEmployee(companyId, body);
    }
    payroll(companyId) {
        return this.service.listPayroll(companyId);
    }
    createPayroll(companyId, body) {
        return this.service.createPayroll(companyId, body);
    }
    payPayroll(companyId, id, body) {
        return this.service.payPayroll(companyId, id, body);
    }
    update(companyId, id, body) {
        return this.service.updateEmployee(companyId, id, body);
    }
    delete(companyId, id) {
        return this.service.deleteEmployee(companyId, id);
    }
};
exports.EmployeesController = EmployeesController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], EmployeesController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], EmployeesController.prototype, "create", null);
__decorate([
    (0, common_1.Get)("payroll"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], EmployeesController.prototype, "payroll", null);
__decorate([
    (0, common_1.Post)("payroll"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], EmployeesController.prototype, "createPayroll", null);
__decorate([
    (0, common_1.Post)("payroll/:id/pay"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", void 0)
], EmployeesController.prototype, "payPayroll", null);
__decorate([
    (0, common_1.Patch)(":id"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", void 0)
], EmployeesController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(":id"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], EmployeesController.prototype, "delete", null);
exports.EmployeesController = EmployeesController = __decorate([
    (0, modules_decorator_1.RequireModules)("employees"),
    (0, common_1.Controller)("employees"),
    __metadata("design:paramtypes", [business_service_1.BusinessService])
], EmployeesController);
let ReportsController = class ReportsController {
    service;
    constructor(service) {
        this.service = service;
    }
    reports(companyId) {
        return this.service.reports(companyId);
    }
    reportType(companyId) {
        return this.service.reports(companyId);
    }
};
exports.ReportsController = ReportsController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "reports", null);
__decorate([
    (0, common_1.Get)(":type"),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "reportType", null);
exports.ReportsController = ReportsController = __decorate([
    (0, modules_decorator_1.RequireModules)("reports"),
    (0, common_1.Controller)("reports"),
    __metadata("design:paramtypes", [business_service_1.BusinessService])
], ReportsController);
let DashboardController = class DashboardController {
    service;
    constructor(service) {
        this.service = service;
    }
    dashboard(companyId) {
        return this.service.dashboard(companyId);
    }
};
exports.DashboardController = DashboardController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], DashboardController.prototype, "dashboard", null);
exports.DashboardController = DashboardController = __decorate([
    (0, modules_decorator_1.RequireModules)("dashboard"),
    (0, common_1.Controller)("dashboard"),
    __metadata("design:paramtypes", [business_service_1.BusinessService])
], DashboardController);
let SettingsController = class SettingsController {
    service;
    constructor(service) {
        this.service = service;
    }
    get(companyId, userId) {
        return this.service.getSettings(companyId, userId);
    }
    update(companyId, userId, body) {
        return this.service.updateSettings(companyId, body, userId);
    }
};
exports.SettingsController = SettingsController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], SettingsController.prototype, "get", null);
__decorate([
    (0, common_1.Patch)(),
    __param(0, (0, current_company_decorator_1.CurrentCompany)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", void 0)
], SettingsController.prototype, "update", null);
exports.SettingsController = SettingsController = __decorate([
    (0, modules_decorator_1.RequireModules)("settings"),
    (0, common_1.Controller)("settings"),
    __metadata("design:paramtypes", [business_service_1.BusinessService])
], SettingsController);
//# sourceMappingURL=business.controller.js.map
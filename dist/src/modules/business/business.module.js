"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BusinessModule = void 0;
const common_1 = require("@nestjs/common");
const business_controller_1 = require("./business.controller");
const business_service_1 = require("./business.service");
let BusinessModule = class BusinessModule {
};
exports.BusinessModule = BusinessModule;
exports.BusinessModule = BusinessModule = __decorate([
    (0, common_1.Module)({
        controllers: [
            business_controller_1.ContextController,
            business_controller_1.ProductsController,
            business_controller_1.WarehousesController,
            business_controller_1.InventoryController,
            business_controller_1.SuppliersController,
            business_controller_1.PurchasesController,
            business_controller_1.SalesController,
            business_controller_1.CustomersController,
            business_controller_1.AgentsController,
            business_controller_1.ManufacturingController,
            business_controller_1.FinanceController,
            business_controller_1.EmployeesController,
            business_controller_1.ReportsController,
            business_controller_1.DashboardController,
            business_controller_1.SettingsController,
        ],
        providers: [business_service_1.BusinessService],
        exports: [business_service_1.BusinessService],
    })
], BusinessModule);
//# sourceMappingURL=business.module.js.map
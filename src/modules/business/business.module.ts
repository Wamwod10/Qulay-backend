import { Module } from "@nestjs/common";

import {
  AgentsController,
  ContextController,
  CustomersController,
  DashboardController,
  EmployeesController,
  FinanceController,
  InventoryController,
  ManufacturingController,
  ProductsController,
  PurchasesController,
  ReportsController,
  SalesController,
  SettingsController,
  SuppliersController,
  WarehousesController,
} from "./business.controller";
import { BusinessService } from "./business.service";

@Module({
  controllers: [
    ContextController,
    ProductsController,
    WarehousesController,
    InventoryController,
    SuppliersController,
    PurchasesController,
    SalesController,
    CustomersController,
    AgentsController,
    ManufacturingController,
    FinanceController,
    EmployeesController,
    ReportsController,
    DashboardController,
    SettingsController,
  ],
  providers: [BusinessService],
  exports: [BusinessService],
})
export class BusinessModule {}

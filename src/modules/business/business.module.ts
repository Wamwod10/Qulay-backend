import { Module } from "@nestjs/common";

import {
  AgentsController,
  CategoriesController,
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
import { FxModule } from "../fx/fx.module";
import { BusinessService } from "./business.service";

@Module({
  imports: [FxModule],
  controllers: [
    ContextController,
    ProductsController,
    CategoriesController,
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

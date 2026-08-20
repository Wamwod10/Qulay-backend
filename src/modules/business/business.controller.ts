import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";

import { CurrentCompany } from "../../common/decorators/current-company.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequireModules } from "../../common/decorators/modules.decorator";
import { AllowInlineCreateFrom } from "../../common/decorators/inline-create.decorator";
import { BusinessService } from "./business.service";

@Controller("context")
export class ContextController {
  constructor(private readonly service: BusinessService) {}

  @Get()
  context(@CurrentUser() user: any, @CurrentCompany() companyId: string) {
    return this.service.currentContext(user, companyId);
  }
}

@RequireModules("products")
@Controller("products")
export class ProductsController {
  constructor(private readonly service: BusinessService) {}

  @Get()
  list(@CurrentCompany() companyId: string, @Query() query: Record<string, string | undefined>) {
    return this.service.listProducts(companyId, query);
  }

  @Get("units")
  units() {
    return this.service.listUnits();
  }

  @Post()
  @AllowInlineCreateFrom("purchases", "manufacturing")
  create(@CurrentCompany() companyId: string, @Body() body: any) {
    return this.service.createProduct(companyId, body);
  }

  @Get(":id")
  get(@CurrentCompany() companyId: string, @Param("id") id: string) {
    return this.service.getProduct(companyId, id);
  }

  @Patch(":id")
  update(@CurrentCompany() companyId: string, @Param("id") id: string, @Body() body: any, @CurrentUser("id") userId: string) {
    return this.service.updateProduct(companyId, id, body, userId);
  }

  @Patch(":id/status")
  status(@CurrentCompany() companyId: string, @Param("id") id: string, @Body() body: any) {
    return this.service.changeProductStatus(companyId, id, body.status);
  }

  @Patch(":id/stock")
  stock(@CurrentCompany() companyId: string, @Param("id") id: string, @Body() body: any, @CurrentUser("id") userId: string) {
    return this.service.adjustProductStock(companyId, id, body, userId);
  }

  @Patch(":id/prices")
  prices(@CurrentCompany() companyId: string, @Param("id") id: string, @Body() body: any, @CurrentUser("id") userId: string) {
    return this.service.updateProductPrices(companyId, id, body, userId);
  }

  @Post(":id/duplicate")
  duplicate(@CurrentCompany() companyId: string, @Param("id") id: string) {
    return this.service.duplicateProduct(companyId, id);
  }

  @Delete(":id")
  delete(@CurrentCompany() companyId: string, @Param("id") id: string) {
    return this.service.deleteProduct(companyId, id);
  }
}

@RequireModules("products")
@Controller("categories")
export class CategoriesController {
  constructor(private readonly service: BusinessService) {}

  @Get()
  list(@CurrentCompany() companyId: string) {
    return this.service.listCategories(companyId);
  }

  @Post()
<<<<<<< HEAD
=======
  @AllowInlineCreateFrom("products")
>>>>>>> beb45cc1 (final)
  create(@CurrentCompany() companyId: string, @Body() body: any) {
    return this.service.createCategory(companyId, body);
  }
}

@RequireModules("warehouse")
@Controller("warehouses")
export class WarehousesController {
  constructor(private readonly service: BusinessService) {}

  @Get()
  list(@CurrentCompany() companyId: string) {
    return this.service.listWarehouses(companyId);
  }

  @Post()
  create(@CurrentCompany() companyId: string, @Body() body: any) {
    return this.service.createWarehouse(companyId, body);
  }
}

@RequireModules("warehouse")
@Controller("inventory")
export class InventoryController {
  constructor(private readonly service: BusinessService) {}

  @Get("stock")
  stock(@CurrentCompany() companyId: string, @Query() query: Record<string, string | undefined>) {
    return this.service.listStock(companyId, query);
  }

  @Get("movements")
  movements(@CurrentCompany() companyId: string, @Query() query: Record<string, string | undefined>) {
    return this.service.listMovements(companyId, query);
  }

  @Get("batches")
  batches(@CurrentCompany() companyId: string, @Query() query: Record<string, string | undefined>) {
    return this.service.listBatches(companyId, query);
  }

  @Get("batches/warnings")
  batchWarnings(@CurrentCompany() companyId: string, @Query() query: Record<string, string | undefined>) {
    return this.service.batchWarnings(companyId, query);
  }

  @Get("counts")
  counts(@CurrentCompany() companyId: string, @Query() query: Record<string, string | undefined>) {
    return this.service.listInventoryCounts(companyId, query);
  }

  @Post("counts")
  count(@CurrentCompany() companyId: string, @Body() body: any, @CurrentUser("id") userId: string) {
    return this.service.createInventoryCount(companyId, body, userId);
  }

  @Get("purchase-suggestions")
  purchaseSuggestions(@CurrentCompany() companyId: string, @Query() query: Record<string, string | undefined>) {
    return this.service.purchaseSuggestions(companyId, query);
  }

  @Post("stock/in")
  stockIn(@CurrentCompany() companyId: string, @Body() body: any) {
    return this.service.stockIn(companyId, body);
  }

  @Post("stock/out")
  stockOut(@CurrentCompany() companyId: string, @Body() body: any) {
    return this.service.stockOut(companyId, body);
  }

  @Post("stock/transfer")
  transfer(@CurrentCompany() companyId: string, @Body() body: any) {
    return this.service.transferStock(companyId, body);
  }
}

@RequireModules("suppliers")
@Controller("suppliers")
export class SuppliersController {
  constructor(private readonly service: BusinessService) {}

  @Get()
  list(@CurrentCompany() companyId: string, @Query() query: Record<string, string | undefined>) {
    return this.service.listSuppliers(companyId, query);
  }

  @Get("price-history")
  priceHistory(@CurrentCompany() companyId: string, @Query() query: Record<string, string | undefined>) {
    return this.service.listSupplierPriceHistory(companyId, query);
  }

  @Post()
  @AllowInlineCreateFrom("purchases", "products", "finance")
  create(@CurrentCompany() companyId: string, @Body() body: any) {
    return this.service.createSupplier(companyId, body);
  }

  @Get(":id")
  get(@CurrentCompany() companyId: string, @Param("id") id: string) {
    return this.service.getSupplier(companyId, id);
  }

  @Patch(":id")
  update(@CurrentCompany() companyId: string, @Param("id") id: string, @Body() body: any) {
    return this.service.updateSupplier(companyId, id, body);
  }

  @Delete(":id")
  delete(@CurrentCompany() companyId: string, @Param("id") id: string) {
    return this.service.deleteSupplier(companyId, id);
  }
}

@RequireModules("purchases")
@Controller("purchases")
export class PurchasesController {
  constructor(private readonly service: BusinessService) {}

  @Get()
  list(@CurrentCompany() companyId: string, @Query() query: Record<string, string | undefined>) {
    return this.service.listPurchases(companyId, query);
  }

  @Post()
  create(@CurrentCompany() companyId: string, @Body() body: any) {
    return this.service.createPurchase(companyId, body);
  }

  @Get(":id")
  get(@CurrentCompany() companyId: string, @Param("id") id: string) {
    return this.service.getPurchase(companyId, id);
  }

  @Patch(":id")
  update(@CurrentCompany() companyId: string, @Param("id") id: string, @Body() body: any) {
    return this.service.updatePurchase(companyId, id, body);
  }

  @Post(":id/receive")
  receive(@CurrentCompany() companyId: string, @Param("id") id: string, @Body() body: any, @CurrentUser("id") userId: string) {
    return this.service.receivePurchase(companyId, id, body, userId);
  }

  @Post(":id/payment")
  payment(@CurrentCompany() companyId: string, @Param("id") id: string, @Body() body: any, @CurrentUser("id") userId: string) {
    return this.service.payPurchase(companyId, id, body, userId);
  }

  @Post(":id/cancel")
  cancel(@CurrentCompany() companyId: string, @Param("id") id: string) {
    return this.service.cancelPurchase(companyId, id);
  }
}

@RequireModules("sales")
@Controller("sales")
export class SalesController {
  constructor(private readonly service: BusinessService) {}

  @Get()
  list(@CurrentCompany() companyId: string, @Query() query: Record<string, string | undefined>) {
    return this.service.listSales(companyId, query);
  }

  @Post()
  hold(@CurrentCompany() companyId: string, @Body() body: any) {
    return this.service.holdSale(companyId, body);
  }

  @Post("complete")
  complete(@CurrentCompany() companyId: string, @Body() body: any, @Req() request: any, @CurrentUser("id") userId: string) {
    return this.service.completeSale(companyId, body, request.headers["idempotency-key"], userId);
  }

  @Get(":id")
  get(@CurrentCompany() companyId: string, @Param("id") id: string) {
    return this.service.getSale(companyId, id);
  }

  @Post(":id/cancel")
  cancel(@CurrentCompany() companyId: string, @Param("id") id: string, @Body() body: any, @CurrentUser("id") userId: string) {
    return this.service.cancelSale(companyId, id, body || {}, userId);
  }

  @Post(":id/return")
  returnItems(@CurrentCompany() companyId: string, @Param("id") id: string, @Body() body: any, @CurrentUser("id") userId: string) {
    return this.service.returnSale(companyId, id, body, userId);
  }
}

@RequireModules("customers")
@Controller("customers")
export class CustomersController {
  constructor(private readonly service: BusinessService) {}

  @Get()
  list(@CurrentCompany() companyId: string) {
    return this.service.listCustomers(companyId);
  }

  @Post()
  @AllowInlineCreateFrom("sales", "finance")
  create(@CurrentCompany() companyId: string, @Body() body: any) {
    return this.service.createCustomer(companyId, body);
  }

  @Get(":id")
  get(@CurrentCompany() companyId: string, @Param("id") id: string) {
    return this.service.getCustomer(companyId, id);
  }

  @Patch(":id")
  update(@CurrentCompany() companyId: string, @Param("id") id: string, @Body() body: any) {
    return this.service.updateCustomer(companyId, id, body);
  }

  @Post(":id/payment")
  payment(@CurrentCompany() companyId: string, @Param("id") id: string, @Body() body: any, @CurrentUser("id") userId: string) {
    return this.service.receiveCustomerPayment(companyId, id, body, userId);
  }

  @Delete(":id")
  delete(@CurrentCompany() companyId: string, @Param("id") id: string) {
    return this.service.deleteCustomer(companyId, id);
  }
}

@RequireModules("agents")
@Controller("agents")
export class AgentsController {
  constructor(private readonly service: BusinessService) {}

  @Get()
  list(@CurrentCompany() companyId: string) {
    return this.service.listAgents(companyId);
  }

  @Post()
  @AllowInlineCreateFrom("sales", "finance")
  create(@CurrentCompany() companyId: string, @Body() body: any) {
    return this.service.createAgent(companyId, body);
  }

  @Get(":id")
  get(@CurrentCompany() companyId: string, @Param("id") id: string) {
    return this.service.getAgent(companyId, id);
  }

  @Patch(":id")
  update(@CurrentCompany() companyId: string, @Param("id") id: string, @Body() body: any) {
    return this.service.updateAgent(companyId, id, body);
  }

  @Delete(":id")
  delete(@CurrentCompany() companyId: string, @Param("id") id: string) {
    return this.service.deleteAgent(companyId, id);
  }
}

@RequireModules("manufacturing")
@Controller("manufacturing")
export class ManufacturingController {
  constructor(private readonly service: BusinessService) {}

  @Get("boms")
  boms(@CurrentCompany() companyId: string) {
    return this.service.listBoms(companyId);
  }

  @Post("boms")
  createBom(@CurrentCompany() companyId: string, @Body() body: any) {
    return this.service.createBom(companyId, body);
  }

  @Get("boms/:id")
  getBom(@CurrentCompany() companyId: string, @Param("id") id: string) {
    return this.service.getBom(companyId, id);
  }

  @Patch("boms/:id")
  updateBom(@CurrentCompany() companyId: string, @Param("id") id: string, @Body() body: any, @CurrentUser("id") userId: string) {
    return this.service.updateBom(companyId, id, body, userId);
  }

  @Delete("boms/:id")
  deleteBom(@CurrentCompany() companyId: string, @Param("id") id: string) {
    return this.service.deleteBom(companyId, id);
  }

  @Get("orders")
  orders(@CurrentCompany() companyId: string) {
    return this.service.listProductionOrders(companyId);
  }

  @Post("orders")
  createOrder(@CurrentCompany() companyId: string, @Body() body: any) {
    return this.service.createProductionOrder(companyId, body);
  }

  @Get("orders/:id")
  order(@CurrentCompany() companyId: string, @Param("id") id: string) {
    return this.service.getProductionOrder(companyId, id);
  }

  @Post("orders/:id/start")
  start(@CurrentCompany() companyId: string, @Param("id") id: string, @Body() body: any, @CurrentUser("id") userId: string) {
    return this.service.startProduction(companyId, id, body || {}, userId);
  }

  @Post("orders/:id/complete")
  complete(@CurrentCompany() companyId: string, @Param("id") id: string, @Body() body: any, @CurrentUser("id") userId: string) {
    return this.service.completeProduction(companyId, id, body || {}, userId);
  }

  @Post("orders/:id/cancel")
  cancel(@CurrentCompany() companyId: string, @Param("id") id: string, @Body() body: any, @CurrentUser("id") userId: string) {
    return this.service.cancelProduction(companyId, id, body || {}, userId);
  }

  @Post("orders/:id/stages/:stageId/start")
  startStage(@CurrentCompany() companyId: string, @Param("id") id: string, @Param("stageId") stageId: string, @Body() body: any) {
    return this.service.updateProductionStage(companyId, id, stageId, "start", body || {});
  }

  @Post("orders/:id/stages/:stageId/complete")
  completeStage(@CurrentCompany() companyId: string, @Param("id") id: string, @Param("stageId") stageId: string, @Body() body: any) {
    return this.service.updateProductionStage(companyId, id, stageId, "complete", body || {});
  }

  @Patch("orders/:id/quality")
  quality(@CurrentCompany() companyId: string, @Param("id") id: string, @Body() body: any) {
    return this.service.updateProductionQuality(companyId, id, body || {});
  }

  @Patch("orders/:id/overhead")
  overhead(@CurrentCompany() companyId: string, @Param("id") id: string, @Body() body: any) {
    return this.service.updateProductionOverhead(companyId, id, Array.isArray(body) ? body : body?.items || body?.overheadItems || []);
  }
}

@RequireModules("finance")
@Controller("finance")
export class FinanceController {
  constructor(private readonly service: BusinessService) {}

  @Get("transactions")
  transactions(@CurrentCompany() companyId: string, @Query() query: Record<string, string | undefined>) {
    return this.service.listFinance(companyId, query);
  }

  @Post("transactions")
  create(@CurrentCompany() companyId: string, @Body() body: any) {
    return this.service.createFinance(companyId, body);
  }

  @Get("cashboxes")
  cashboxes(@CurrentCompany() companyId: string) {
    return this.service.listCashboxes(companyId);
  }
}

@RequireModules("employees")
@Controller("employees")
export class EmployeesController {
  constructor(private readonly service: BusinessService) {}

  @Get()
  list(@CurrentCompany() companyId: string) {
    return this.service.listEmployees(companyId);
  }

  @Post()
  create(@CurrentCompany() companyId: string, @Body() body: any) {
    return this.service.createEmployee(companyId, body);
  }

  @Get("payroll")
  payroll(@CurrentCompany() companyId: string) {
    return this.service.listPayroll(companyId);
  }

  @Post("payroll")
  createPayroll(@CurrentCompany() companyId: string, @Body() body: any) {
    return this.service.createPayroll(companyId, body);
  }

  @Post("payroll/:id/pay")
  payPayroll(@CurrentCompany() companyId: string, @Param("id") id: string, @Body() body: any, @CurrentUser("id") userId: string) {
    return this.service.payPayroll(companyId, id, body, userId);
  }

  @Patch(":id")
  update(@CurrentCompany() companyId: string, @Param("id") id: string, @Body() body: any) {
    return this.service.updateEmployee(companyId, id, body);
  }

  @Delete(":id")
  delete(@CurrentCompany() companyId: string, @Param("id") id: string) {
    return this.service.deleteEmployee(companyId, id);
  }
}

@RequireModules("reports")
@Controller("reports")
export class ReportsController {
  constructor(private readonly service: BusinessService) {}

  @Get()
  reports(@CurrentCompany() companyId: string) {
    return this.service.reports(companyId);
  }

  @Get(":type")
  reportType(@CurrentCompany() companyId: string) {
    return this.service.reports(companyId);
  }
}

@RequireModules("dashboard")
@Controller("dashboard")
export class DashboardController {
  constructor(private readonly service: BusinessService) {}

  @Get()
  dashboard(@CurrentCompany() companyId: string) {
    return this.service.dashboard(companyId);
  }
}

@RequireModules("settings")
@Controller("settings")
export class SettingsController {
  constructor(private readonly service: BusinessService) {}

  @Get()
  get(@CurrentCompany() companyId: string, @CurrentUser("id") userId: string) {
    return this.service.getSettings(companyId, userId);
  }

  @Patch()
  update(@CurrentCompany() companyId: string, @CurrentUser("id") userId: string, @Body() body: any) {
    return this.service.updateSettings(companyId, body, userId);
  }
}

import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";

import { CurrentCompany } from "../../common/decorators/current-company.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequireModules } from "../../common/decorators/modules.decorator";
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

  @Post()
  create(@CurrentCompany() companyId: string, @Body() body: any) {
    return this.service.createProduct(companyId, body);
  }

  @Get(":id")
  get(@CurrentCompany() companyId: string, @Param("id") id: string) {
    return this.service.getProduct(companyId, id);
  }

  @Patch(":id")
  update(@CurrentCompany() companyId: string, @Param("id") id: string, @Body() body: any) {
    return this.service.updateProduct(companyId, id, body);
  }

  @Patch(":id/status")
  status(@CurrentCompany() companyId: string, @Param("id") id: string, @Body() body: any) {
    return this.service.changeProductStatus(companyId, id, body.status);
  }

  @Patch(":id/stock")
  stock(@CurrentCompany() companyId: string, @Param("id") id: string, @Body() body: any) {
    return this.service.adjustProductStock(companyId, id, body);
  }

  @Patch(":id/prices")
  prices(@CurrentCompany() companyId: string, @Param("id") id: string, @Body() body: any) {
    return this.service.updateProductPrices(companyId, id, body);
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

  @Post()
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
  receive(@CurrentCompany() companyId: string, @Param("id") id: string, @Body() body: any) {
    return this.service.receivePurchase(companyId, id, body);
  }

  @Post(":id/payment")
  payment(@CurrentCompany() companyId: string, @Param("id") id: string, @Body() body: any) {
    return this.service.payPurchase(companyId, id, body);
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
  complete(@CurrentCompany() companyId: string, @Body() body: any, @Req() request: any) {
    return this.service.completeSale(companyId, body, request.headers["idempotency-key"]);
  }

  @Get(":id")
  get(@CurrentCompany() companyId: string, @Param("id") id: string) {
    return this.service.getSale(companyId, id);
  }

  @Post(":id/cancel")
  cancel(@CurrentCompany() companyId: string, @Param("id") id: string, @Body() body: any) {
    return this.service.cancelSale(companyId, id, body || {});
  }

  @Post(":id/return")
  returnItems(@CurrentCompany() companyId: string, @Param("id") id: string, @Body() body: any) {
    return this.service.returnSale(companyId, id, body);
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
  payment(@CurrentCompany() companyId: string, @Param("id") id: string, @Body() body: any) {
    return this.service.receiveCustomerPayment(companyId, id, body);
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
  updateBom(@CurrentCompany() companyId: string, @Param("id") id: string, @Body() body: any) {
    return this.service.updateBom(companyId, id, body);
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
  start(@CurrentCompany() companyId: string, @Param("id") id: string, @Body() body: any) {
    return this.service.startProduction(companyId, id, body || {});
  }

  @Post("orders/:id/complete")
  complete(@CurrentCompany() companyId: string, @Param("id") id: string, @Body() body: any) {
    return this.service.completeProduction(companyId, id, body || {});
  }

  @Post("orders/:id/cancel")
  cancel(@CurrentCompany() companyId: string, @Param("id") id: string) {
    return this.service.cancelProduction(companyId, id);
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
  payPayroll(@CurrentCompany() companyId: string, @Param("id") id: string, @Body() body: any) {
    return this.service.payPayroll(companyId, id, body);
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

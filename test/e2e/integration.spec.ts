import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { AddressInfo } from "node:net";

import * as bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

import { PLATFORM_MODULES } from "../../src/common/constants/modules.constants";
import { loadTestEnv } from "../test-env";

type ApiResult = {
  status: number;
  body: any;
  headers: Headers;
};

type Fixture = {
  user: { id: string; email: string; phone: string };
  company: { id: string };
  warehouse: { id: string };
  password: string;
};

const prisma = new PrismaClient();
const password = "Passw0rd1";
let baseUrl = "";
let app: { listen: (port: number) => Promise<unknown>; getHttpServer: () => { address: () => AddressInfo }; close: () => Promise<void> };
let fixtureCounter = 0;
let requestCounter = 0;

async function resetDatabase() {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "User", "Company", "PlatformModule", "Permission", "Role" RESTART IDENTITY CASCADE');
}

async function api(path: string, options: { method?: string; token?: string; companyId?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<ApiResult> {
  const headers: Record<string, string> = { ...(options.headers || {}) };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.companyId) headers["x-company-id"] = options.companyId;
  const response = await fetch(`${baseUrl}/api${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body, headers: response.headers };
}

async function login(email: string, fixture?: Fixture) {
  requestCounter += 1;
  const result = await api("/auth/login", {
    method: "POST",
    body: { identifier: email, password },
    companyId: fixture?.company.id,
    headers: { "x-forwarded-for": `10.20.0.${requestCounter}` },
  });
  assert.ok([200, 201].includes(result.status), JSON.stringify(result.body));
  assert.ok(result.body.accessToken);
  assert.equal(JSON.stringify(result.body).includes("passwordHash"), false);
  return result.body.accessToken as string;
}

async function createFixture(prefix: string, role: "OWNER" | "SUPER_ADMIN" = "OWNER"): Promise<Fixture> {
  fixtureCounter += 1;
  const slug = `${prefix}-${Date.now()}-${fixtureCounter}`.replace(/[^a-z0-9-]/gi, "").toLowerCase();
  const user = await prisma.user.create({
    data: {
      fullName: `${prefix} User`,
      email: `${slug}@example.test`,
      phone: `+9989000${String(fixtureCounter).padStart(5, "0")}`,
      passwordHash: await bcrypt.hash(password, 4),
      role,
      status: "ACTIVE",
      jobTitle: role === "SUPER_ADMIN" ? "Super Admin" : "Owner",
    },
  });

  if (role === "SUPER_ADMIN") {
    return { user, company: { id: "" }, warehouse: { id: "" }, password };
  }

  const company = await prisma.company.create({
    data: {
      name: `${prefix} Company`,
      businessName: `${prefix} Company`,
      email: user.email,
      phone: user.phone,
      ownerUserId: user.id,
      currency: "UZS",
    },
  });
  await prisma.companyMember.create({ data: { userId: user.id, companyId: company.id, role: "OWNER" } });
  const modules = await Promise.all(PLATFORM_MODULES.map((module) => prisma.platformModule.upsert({
    where: { key: module.key },
    update: { enabled: true, locked: module.locked, name: module.name },
    create: { key: module.key, name: module.name, locked: module.locked, enabled: true },
  })));
  await prisma.companyModuleAccess.createMany({ data: modules.map((module) => ({ companyId: company.id, moduleId: module.id, enabled: true })) });
  const warehouse = await prisma.warehouse.create({ data: { companyId: company.id, name: "Main Warehouse", code: `MAIN-${fixtureCounter}` } });
  await prisma.cashbox.create({ data: { companyId: company.id, name: "Main Cashbox", currency: "UZS" } });
  await prisma.branch.create({ data: { companyId: company.id, name: "Main Branch" } });

  return { user, company, warehouse, password };
}

async function createProduct(token: string, fixture: Fixture, name: string, sku: string, stock: number, salePrice = 200_000) {
  const result = await api("/products", {
    method: "POST",
    token,
    companyId: fixture.company.id,
    body: { name, sku, stock, cost: 100_000, salePrice, warehouseId: fixture.warehouse.id },
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body;
}

before(async () => {
  loadTestEnv();
  await prisma.$connect();
  await resetDatabase();
  const factory = await import("../../dist/src/app.factory.js");
  app = await factory.createConfiguredApp() as typeof app;
  await app.listen(0);
  const address = app.getHttpServer().address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("health, auth and error boundaries", () => {
  test("health reports application and database status with security headers", async () => {
    const result = await api("/health");
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.status, "ok");
    assert.deepEqual(result.body.database, "ok");
    assert.equal(result.headers.get("x-content-type-options"), "nosniff");
    assert.equal(result.headers.get("x-frame-options"), "DENY");
  });

  test("register, login, wrong password, me, missing token and invalid token", async () => {
    const email = `register-${Date.now()}@example.test`;
    const register = await api("/auth/register", {
      method: "POST",
      body: {
        businessName: "Registered Company",
        fullName: "Registered User",
        email,
        phone: "+998901234567",
        password,
        confirmPassword: password,
        unexpected: "must be rejected",
      },
    });
    assert.equal(register.status, 400);

    const validRegister = await api("/auth/register", {
      method: "POST",
      body: {
        businessName: "Registered Company",
        fullName: "Registered User",
        email,
        phone: "+998901234568",
        password,
        confirmPassword: password,
      },
    });
    assert.equal(validRegister.status, 201, JSON.stringify(validRegister.body));
    assert.ok(validRegister.body.accessToken);
    assert.equal(JSON.stringify(validRegister.body).includes("passwordHash"), false);

    const wrongPassword = await api("/auth/login", {
      method: "POST",
      body: { identifier: email, password: "WrongPass9" },
      headers: { "x-forwarded-for": "10.21.0.1" },
    });
    assert.equal(wrongPassword.status, 401);
    assert.equal(wrongPassword.body.code, "INVALID_CREDENTIALS");

    const fixture = await createFixture("auth");
    const token = await login(fixture.user.email, fixture);
    const me = await api("/auth/me", { token, companyId: fixture.company.id });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.id, fixture.user.id);
    assert.equal(JSON.stringify(me.body).includes("passwordHash"), false);
    const malformedId = await api("/products/not-a-valid-cuid", { token, companyId: fixture.company.id });
    assert.equal(malformedId.status, 404);
    assert.equal(JSON.stringify(malformedId.body).includes("stack"), false);

    const missing = await api("/auth/me");
    assert.equal(missing.status, 401);
    assert.equal(missing.body.code, "UNAUTHENTICATED");
    const invalid = await api("/auth/me", { token: "not-a-real-token", companyId: fixture.company.id });
    assert.equal(invalid.status, 401);
    assert.equal(invalid.body.code, "INVALID_TOKEN");

    await prisma.user.update({ where: { id: fixture.user.id }, data: { status: "BLOCKED" } });
    const blockedMe = await api("/auth/me", { token, companyId: fixture.company.id });
    assert.equal(blockedMe.status, 403);
    assert.equal(blockedMe.body.code, "ACCOUNT_BLOCKED");
  });

  test("MVP password reset validates, updates bcrypt and allows a new login", async () => {
    const fixture = await createFixture("password-reset");
    const mismatch = await api("/auth/reset-password", {
      method: "POST",
      body: { email: fixture.user.email, newPassword: "NewPassw0rd", confirmPassword: "Different9" },
    });
    assert.equal(mismatch.status, 400);
    assert.equal(mismatch.body.code, "PASSWORD_MISMATCH");

    const result = await api("/auth/reset-password", {
      method: "POST",
      body: { email: fixture.user.email, newPassword: "NewPassw0rd", confirmPassword: "NewPassw0rd" },
    });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.success, true);

    const newLogin = await api("/auth/login", {
      method: "POST",
      body: { identifier: fixture.user.email, password: "NewPassw0rd" },
      headers: { "x-forwarded-for": `10.25.0.${++requestCounter}` },
    });
    assert.ok([200, 201].includes(newLogin.status), JSON.stringify(newLogin.body));
    assert.ok(newLogin.body.accessToken);

    const audit = await prisma.auditLog.findFirst({ where: { action: "password.reset", targetId: fixture.user.id } });
    assert.ok(audit);
  });
});

describe("super admin and module access", () => {
  test("super admin login carries the canonical role through JWT and me, without a company", async () => {
    const superAdmin = await createFixture("superadmin-auth", "SUPER_ADMIN");
    const successfulLogin = await api("/auth/login", {
      method: "POST",
      body: { identifier: superAdmin.user.email, password },
      headers: { "x-forwarded-for": `10.22.0.${++requestCounter}` },
    });

    assert.ok([200, 201].includes(successfulLogin.status), JSON.stringify(successfulLogin.body));
    assert.equal(successfulLogin.body.user.id, superAdmin.user.id);
    assert.equal(successfulLogin.body.user.email, superAdmin.user.email);
    assert.equal(successfulLogin.body.user.role, "SUPER_ADMIN");
    assert.equal(successfulLogin.body.user.status, "ACTIVE");
    assert.equal(successfulLogin.body.account.id, "platform");
    assert.equal(JSON.stringify(successfulLogin.body).includes("passwordHash"), false);

    const token = successfulLogin.body.accessToken as string;
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    assert.equal(payload.sub, superAdmin.user.id);
    assert.equal(payload.role, "SUPER_ADMIN");

    const me = await api("/auth/me", { token });
    assert.equal(me.status, 200, JSON.stringify(me.body));
    assert.equal(me.body.user.role, "SUPER_ADMIN");
    assert.equal(me.body.role, "SUPER_ADMIN");
    assert.equal(JSON.stringify(me.body).includes("passwordHash"), false);

    const dashboard = await api("/superadmin/dashboard", { token });
    assert.equal(dashboard.status, 200, JSON.stringify(dashboard.body));

    const wrongPassword = await api("/auth/login", {
      method: "POST",
      body: { identifier: superAdmin.user.email, password: "WrongPass9" },
      headers: { "x-forwarded-for": `10.23.0.${++requestCounter}` },
    });
    assert.equal(wrongPassword.status, 401);
    assert.equal(wrongPassword.body.code, "INVALID_CREDENTIALS");

    await prisma.user.update({ where: { id: superAdmin.user.id }, data: { status: "BLOCKED" } });
    const blockedLogin = await api("/auth/login", {
      method: "POST",
      body: { identifier: superAdmin.user.email, password },
      headers: { "x-forwarded-for": `10.24.0.${++requestCounter}` },
    });
    assert.equal(blockedLogin.status, 403);
    assert.equal(blockedLogin.body.code, "ACCOUNT_BLOCKED");
  });

  test("super admin lists protected resources, blocks/unblocks users and records audit logs", async () => {
    const superAdmin = await createFixture("superadmin", "SUPER_ADMIN");
    const owner = await createFixture("managed-owner");
    const superToken = await login(superAdmin.user.email);
    const ownerToken = await login(owner.user.email, owner);

    const forbiddenDashboard = await api("/superadmin/dashboard", { token: ownerToken, companyId: owner.company.id });
    assert.equal(forbiddenDashboard.status, 403);
    const forbidden = await api("/superadmin/users", { token: ownerToken, companyId: owner.company.id });
    assert.equal(forbidden.status, 403);
    const users = await api("/superadmin/users", { token: superToken });
    assert.equal(users.status, 200);
    assert.ok(users.body.users.some((user: any) => user.id === owner.user.id));
    assert.equal(JSON.stringify(users.body).includes("passwordHash"), false);

    const companies = await api("/superadmin/companies", { token: superToken });
    assert.equal(companies.status, 200);
    assert.ok(companies.body.companies.some((company: any) => company.id === owner.company.id));
    const modules = await api("/superadmin/modules", { token: superToken });
    assert.equal(modules.status, 200);
    assert.ok(modules.body.modules.some((module: any) => module.key === "sales"));

    const blocked = await api(`/superadmin/users/${owner.user.id}/status`, { method: "PATCH", token: superToken, body: { status: "BLOCKED" } });
    assert.equal(blocked.status, 200);
    const blockedTokenResult = await api("/auth/me", { token: ownerToken, companyId: owner.company.id });
    assert.equal(blockedTokenResult.status, 403);
    const unblocked = await api(`/superadmin/users/${owner.user.id}/status`, { method: "PATCH", token: superToken, body: { status: "ACTIVE" } });
    assert.equal(unblocked.status, 200);

    const audit = await prisma.auditLog.findMany({ where: { targetId: owner.user.id, action: { in: ["user.blocked", "user.unblocked"] } } });
    assert.equal(audit.length, 2);
  });

  test("global and account module switches follow effective access rules", async () => {
    const superAdmin = await createFixture("module-superadmin", "SUPER_ADMIN");
    const owner = await createFixture("module-owner");
    const superToken = await login(superAdmin.user.email);
    const ownerToken = await login(owner.user.email, owner);

    const globalOff = await api("/superadmin/modules/products", { method: "PATCH", token: superToken, body: { enabled: false } });
    assert.equal(globalOff.status, 200);
    const accountOnWhileGlobalOff = await api("/superadmin/accounts/" + owner.company.id + "/modules/products", { method: "PATCH", token: superToken, body: { enabled: true } });
    assert.equal(accountOnWhileGlobalOff.status, 200);
    assert.equal((await api("/products", { token: ownerToken, companyId: owner.company.id })).status, 403);

    const globalOn = await api("/superadmin/modules/products", { method: "PATCH", token: superToken, body: { enabled: true } });
    assert.equal(globalOn.status, 200);
    const accountOff = await api("/superadmin/accounts/" + owner.company.id + "/modules/products", { method: "PATCH", token: superToken, body: { enabled: false } });
    assert.equal(accountOff.status, 200);
    assert.equal((await api("/products", { token: ownerToken, companyId: owner.company.id })).status, 403);

    const accountOn = await api("/superadmin/accounts/" + owner.company.id + "/modules/products", { method: "PATCH", token: superToken, body: { enabled: true } });
    assert.equal(accountOn.status, 200);
    assert.equal((await api("/products", { token: ownerToken, companyId: owner.company.id })).status, 200);
    const audit = await prisma.auditLog.findMany({ where: { action: { in: ["module.global_disabled", "module.global_enabled", "company_module.disabled", "company_module.enabled"] } } });
    assert.ok(audit.length >= 4);
  });
});

describe("tenant isolation and transaction invariants", () => {
  test("tenant A cannot list, read, update or delete tenant B resources", async () => {
    const tenantA = await createFixture("tenant-a");
    const tenantB = await createFixture("tenant-b");
    const tokenA = await login(tenantA.user.email, tenantA);
    const tokenB = await login(tenantB.user.email, tenantB);
    const productA = await createProduct(tokenA, tenantA, "Product A", `A-${fixtureCounter}`, 10, 10);
    const productB = await createProduct(tokenB, tenantB, "Product B", `B-${fixtureCounter}`, 10, 10);
    const customerB = await api("/customers", { method: "POST", token: tokenB, companyId: tenantB.company.id, body: { name: "Customer B" } });
    assert.equal(customerB.status, 201);
    const saleB = await api("/sales/complete", {
      method: "POST",
      token: tokenB,
      companyId: tenantB.company.id,
      headers: { "idempotency-key": `tenant-b-sale-${Date.now()}` },
      body: { warehouseId: tenantB.warehouse.id, customerId: customerB.body.id, items: [{ productId: productB.id, quantity: 1, price: 10, cost: 5 }], payments: [{ method: "CASH", amount: 10 }] },
    });
    assert.equal(saleB.status, 201);

    const productsA = await api("/products", { token: tokenA, companyId: tenantA.company.id });
    assert.equal(productsA.status, 200);
    assert.ok(productsA.body.products.some((product: any) => product.id === productA.id));
    assert.equal(productsA.body.products.some((product: any) => product.id === productB.id), false);
    assert.equal((await api(`/products/${productB.id}`, { token: tokenA, companyId: tenantA.company.id })).status, 404);
    assert.equal((await api(`/products/${productB.id}`, { method: "PATCH", token: tokenA, companyId: tenantA.company.id, body: { name: "cross-tenant" } })).status, 404);
    assert.equal((await api(`/products/${productB.id}`, { method: "DELETE", token: tokenA, companyId: tenantA.company.id })).status, 404);
    assert.equal((await api("/customers", { token: tokenA, companyId: tenantA.company.id })).body.customers.some((customer: any) => customer.id === customerB.body.id), false);
    assert.equal((await api(`/customers/${customerB.body.id}`, { token: tokenA, companyId: tenantA.company.id })).status, 404);
    assert.equal((await api(`/customers/${customerB.body.id}`, { method: "PATCH", token: tokenA, companyId: tenantA.company.id, body: { name: "cross-tenant" } })).status, 404);
    assert.equal((await api(`/customers/${customerB.body.id}`, { method: "DELETE", token: tokenA, companyId: tenantA.company.id })).status, 404);
    assert.equal((await api("/sales", { token: tokenA, companyId: tenantA.company.id })).body.sales.some((sale: any) => sale.id === saleB.body.id), false);
    assert.equal((await api(`/sales/${saleB.body.id}`, { token: tokenA, companyId: tenantA.company.id })).status, 404);
    assert.equal((await api(`/inventory/stock?productId=${productB.id}`, { token: tokenA, companyId: tenantA.company.id })).body.stock.length, 0);
    assert.equal((await api("/finance/transactions", { token: tokenA, companyId: tenantA.company.id })).body.transactions.some((transaction: any) => transaction.saleId === saleB.body.id), false);
  });

  test("sale completion is atomic, updates stock/debt/finance and is idempotent", async () => {
    const fixture = await createFixture("sales");
    const token = await login(fixture.user.email, fixture);
    const product = await createProduct(token, fixture, "Sales Product", `SALE-${fixtureCounter}`, 100);
    const agentResult = await api("/agents", { method: "POST", token, companyId: fixture.company.id, body: { name: "Agent One", commissionRate: 2 } });
    assert.equal(agentResult.status, 201);
    const customerResult = await api("/customers", { method: "POST", token, companyId: fixture.company.id, body: { name: "Debtor", creditLimit: 1_000_000 } });
    assert.equal(customerResult.status, 201);
    const key = `sale-integration-${Date.now()}`;
    const payload = {
      warehouseId: fixture.warehouse.id,
      customerId: customerResult.body.id,
      agentId: agentResult.body.id,
      items: [{ productId: product.id, productName: product.name, quantity: 3, price: 200_000, cost: 100_000 }],
      payments: [{ method: "CASH", amount: 500_000 }],
    };
    const sale = await api("/sales/complete", { method: "POST", token, companyId: fixture.company.id, headers: { "idempotency-key": key }, body: payload });
    assert.equal(sale.status, 201, JSON.stringify(sale.body));
    assert.equal(sale.body.status, "COMPLETED");
    assert.equal(sale.body.debtAmount, 100_000);
    const duplicate = await api("/sales/complete", { method: "POST", token, companyId: fixture.company.id, headers: { "idempotency-key": key }, body: payload });
    assert.ok([200, 201].includes(duplicate.status));
    assert.equal(duplicate.body.id, sale.body.id);

    const stock = await prisma.stockItem.findUnique({ where: { companyId_warehouseId_productId: { companyId: fixture.company.id, warehouseId: fixture.warehouse.id, productId: product.id } } });
    assert.equal(Number(stock?.quantity), 97);
    assert.equal(await prisma.stockMovement.count({ where: { companyId: fixture.company.id, sourceType: "SALE", sourceId: sale.body.id, type: "OUT" } }), 1);
    assert.equal(await prisma.financeTransaction.count({ where: { companyId: fixture.company.id, saleId: sale.body.id, type: "IN" } }), 1);
    assert.equal(await prisma.sale.count({ where: { companyId: fixture.company.id, id: sale.body.id, customerId: customerResult.body.id } }), 1);
    assert.equal(await prisma.sale.count({ where: { companyId: fixture.company.id, agentId: agentResult.body.id, status: "COMPLETED" } }), 1);

    const customerAfterSale = await prisma.customer.findUnique({ where: { id: customerResult.body.id } });
    assert.equal(Number(customerAfterSale?.debtBalance), 100_000);
    const payment = await api(`/customers/${customerResult.body.id}/payment`, { method: "POST", token, companyId: fixture.company.id, body: { amount: 50_000, idempotencyKey: `customer-payment-${Date.now()}` } });
    assert.equal(payment.status, 201);
    const customerAfterPayment = await prisma.customer.findUnique({ where: { id: customerResult.body.id } });
    assert.equal(Number(customerAfterPayment?.debtBalance), 50_000);
    const overpayment = await api(`/customers/${customerResult.body.id}/payment`, { method: "POST", token, companyId: fixture.company.id, body: { amount: 60_000, idempotencyKey: `customer-overpay-${Date.now()}` } });
    assert.equal(overpayment.status, 400);
    assert.equal(overpayment.body.code, "OVERPAYMENT");

    const anonymousDebt = await api("/sales/complete", { method: "POST", token, companyId: fixture.company.id, headers: { "idempotency-key": `anonymous-debt-${Date.now()}` }, body: { warehouseId: fixture.warehouse.id, items: [{ productId: product.id, quantity: 1, price: 200_000 }], payments: [{ method: "CASH", amount: 100_000 }] } });
    assert.equal(anonymousDebt.status, 400);
    assert.equal(anonymousDebt.body.code, "CUSTOMER_REQUIRED_FOR_DEBT");
  });

  test("purchase receive and supplier payment do not duplicate stock", async () => {
    const fixture = await createFixture("purchases");
    const token = await login(fixture.user.email, fixture);
    const product = await createProduct(token, fixture, "Purchase Product", `PURCHASE-${fixtureCounter}`, 0, 20);
    const supplier = await api("/suppliers", { method: "POST", token, companyId: fixture.company.id, body: { name: "Supplier One" } });
    assert.equal(supplier.status, 201);
    const purchase = await api("/purchases", { method: "POST", token, companyId: fixture.company.id, body: { supplierId: supplier.body.id, warehouseId: fixture.warehouse.id, items: [{ productId: product.id, quantity: 100, cost: 10, salePrice: 20 }] } });
    assert.equal(purchase.status, 201);
    const received = await api(`/purchases/${purchase.body.id}/receive`, { method: "POST", token, companyId: fixture.company.id, body: {} });
    assert.equal(received.status, 201);
    assert.equal(received.body.status, "RECEIVED");
    const duplicateReceive = await api(`/purchases/${purchase.body.id}/receive`, { method: "POST", token, companyId: fixture.company.id, body: {} });
    assert.equal(duplicateReceive.status, 409);
    const stockAfterReceive = await prisma.stockItem.findUnique({ where: { companyId_warehouseId_productId: { companyId: fixture.company.id, warehouseId: fixture.warehouse.id, productId: product.id } } });
    assert.equal(Number(stockAfterReceive?.quantity), 100);
    const supplierAfterReceive = await prisma.supplier.findUnique({ where: { id: supplier.body.id } });
    assert.equal(Number(supplierAfterReceive?.debtBalance), 1_000);
    const paid = await api(`/purchases/${purchase.body.id}/payment`, { method: "POST", token, companyId: fixture.company.id, body: { amount: 400, idempotencyKey: `purchase-payment-${Date.now()}` } });
    assert.equal(paid.status, 201);
    const supplierAfterPayment = await prisma.supplier.findUnique({ where: { id: supplier.body.id } });
    assert.equal(Number(supplierAfterPayment?.debtBalance), 600);
    assert.equal(Number(paid.body.debtAmount), 600);
  });

  test("manufacturing consumes materials once and produces output once", async () => {
    const fixture = await createFixture("manufacturing");
    const token = await login(fixture.user.email, fixture);
    const material = await createProduct(token, fixture, "Material", `MAT-${fixtureCounter}`, 20, 20);
    const output = await createProduct(token, fixture, "Output", `OUT-${fixtureCounter}`, 0, 50);
    const bom = await api("/manufacturing/boms", { method: "POST", token, companyId: fixture.company.id, body: { name: "Simple BOM", outputProductId: output.id, outputQuantity: 1, materials: [{ productId: material.id, productName: material.name, quantity: 2, cost: 5 }] } });
    assert.equal(bom.status, 201);
    const order = await api("/manufacturing/orders", { method: "POST", token, companyId: fixture.company.id, body: { bomId: bom.body.id, warehouseId: fixture.warehouse.id, plannedQuantity: 5 } });
    assert.equal(order.status, 201);
    const started = await api(`/manufacturing/orders/${order.body.id}/start`, { method: "POST", token, companyId: fixture.company.id, body: {} });
    assert.equal(started.status, 201);
    const duplicateStart = await api(`/manufacturing/orders/${order.body.id}/start`, { method: "POST", token, companyId: fixture.company.id, body: {} });
    assert.equal(duplicateStart.status, 201);
    const completed = await api(`/manufacturing/orders/${order.body.id}/complete`, { method: "POST", token, companyId: fixture.company.id, body: { actualQuantity: 5 } });
    assert.equal(completed.status, 201);
    assert.equal(completed.body.status, "COMPLETED");
    assert.ok(Number(completed.body.productionCost) > 0);
    const duplicateComplete = await api(`/manufacturing/orders/${order.body.id}/complete`, { method: "POST", token, companyId: fixture.company.id, body: { actualQuantity: 5 } });
    assert.equal(duplicateComplete.status, 201);
    const materialStock = await prisma.stockItem.findUnique({ where: { companyId_warehouseId_productId: { companyId: fixture.company.id, warehouseId: fixture.warehouse.id, productId: material.id } } });
    const outputStock = await prisma.stockItem.findUnique({ where: { companyId_warehouseId_productId: { companyId: fixture.company.id, warehouseId: fixture.warehouse.id, productId: output.id } } });
    assert.equal(Number(materialStock?.quantity), 10);
    assert.equal(Number(outputStock?.quantity), 5);
    assert.equal(await prisma.stockMovement.count({ where: { companyId: fixture.company.id, sourceType: "PRODUCTION", sourceId: order.body.id, type: "CONSUME" } }), 1);
    assert.equal(await prisma.stockMovement.count({ where: { companyId: fixture.company.id, sourceType: "PRODUCTION", sourceId: order.body.id, type: "PRODUCE" } }), 1);
  });

  test("batch expiry, inventory count, recipe version, packaging and COGS persist through APIs", async () => {
    const fixture = await createFixture("new-flows");
    const token = await login(fixture.user.email, fixture);
    const raw = await api("/products", {
      method: "POST",
      token,
      companyId: fixture.company.id,
      body: { name: "Integration Flour", sku: `FLOW-RAW-${fixtureCounter}`, type: "RAW_MATERIAL", unit: "kg", stock: 10, cost: 10, salePrice: 0, warehouseId: fixture.warehouse.id, reorderPoint: 12 },
    });
    assert.equal(raw.status, 201, JSON.stringify(raw.body));
    const bag = await api("/products", {
      method: "POST",
      token,
      companyId: fixture.company.id,
      body: { name: "Integration Bag", sku: `FLOW-BAG-${fixtureCounter}`, type: "RAW_MATERIAL", unit: "dona", stock: 3, cost: 1, salePrice: 0, warehouseId: fixture.warehouse.id },
    });
    assert.equal(bag.status, 201, JSON.stringify(bag.body));
    const output = await api("/products", {
      method: "POST",
      token,
      companyId: fixture.company.id,
      body: { name: "Integration Powder", sku: `FLOW-OUT-${fixtureCounter}`, type: "FINISHED_GOOD", unit: "kg", stock: 0, cost: 0, salePrice: 50, warehouseId: fixture.warehouse.id },
    });
    assert.equal(output.status, 201, JSON.stringify(output.body));

    const supplier = await api("/suppliers", { method: "POST", token, companyId: fixture.company.id, body: { name: "Flow Supplier" } });
    assert.equal(supplier.status, 201);
    const purchase = await api("/purchases", {
      method: "POST",
      token,
      companyId: fixture.company.id,
      body: { supplierId: supplier.body.id, warehouseId: fixture.warehouse.id, items: [{ productId: raw.body.id, quantity: 1, cost: 11, unit: "kg" }] },
    });
    assert.equal(purchase.status, 201, JSON.stringify(purchase.body));
    const expiryDate = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const received = await api(`/purchases/${purchase.body.id}/receive`, {
      method: "POST",
      token,
      companyId: fixture.company.id,
      body: { expiryDate, idempotencyKey: `flow-receive-${fixtureCounter}` },
    });
    assert.equal(received.status, 201, JSON.stringify(received.body));
    const batches = await api(`/inventory/batches?productId=${raw.body.id}`, { token, companyId: fixture.company.id });
    assert.equal(batches.status, 200);
    assert.ok(batches.body.batches.some((batch: any) => batch.expiryStatus === "near_expiry"));
    const warnings = await api(`/inventory/batches/warnings?productId=${raw.body.id}&days=30`, { token, companyId: fixture.company.id });
    assert.equal(warnings.status, 200);
    assert.ok(warnings.body.warnings.length >= 1);

    const stockOut = await api("/inventory/stock/out", {
      method: "POST",
      token,
      companyId: fixture.company.id,
      body: { warehouseId: fixture.warehouse.id, productId: raw.body.id, quantity: 1, idempotencyKey: `flow-fefo-${fixtureCounter}` },
    });
    assert.equal(stockOut.status, 201, JSON.stringify(stockOut.body));
    assert.equal(await prisma.batchConsumption.count({ where: { companyId: fixture.company.id, productId: raw.body.id } }), 1);

    const count = await api("/inventory/counts", {
      method: "POST",
      token,
      companyId: fixture.company.id,
      body: { warehouseId: fixture.warehouse.id, productId: raw.body.id, actualQuantity: 9, reason: "Flow count" },
    });
    assert.equal(count.status, 201, JSON.stringify(count.body));
    assert.equal(Number(count.body.difference), -1);
    assert.equal(await prisma.inventoryCount.count({ where: { companyId: fixture.company.id, productId: raw.body.id } }), 1);

    const bom = await api("/manufacturing/boms", {
      method: "POST",
      token,
      companyId: fixture.company.id,
      body: { name: "Flow Recipe", outputProductId: output.body.id, outputQuantity: 1, normalWastePercent: 2, materials: [{ productId: raw.body.id, productName: raw.body.name, quantity: 1, unit: "kg", cost: 10 }] },
    });
    assert.equal(bom.status, 201, JSON.stringify(bom.body));
    const versionTwo = await api(`/manufacturing/boms/${bom.body.id}`, {
      method: "PATCH",
      token,
      companyId: fixture.company.id,
      body: { outputProductId: output.body.id, outputQuantity: 1, normalWastePercent: 2, materials: [{ productId: raw.body.id, productName: raw.body.name, quantity: 1, unit: "kg", cost: 10 }] },
    });
    assert.equal(versionTwo.status, 200, JSON.stringify(versionTwo.body));
    assert.equal(Number(versionTwo.body.version), 2);

    const order = await api("/manufacturing/orders", {
      method: "POST",
      token,
      companyId: fixture.company.id,
      body: { bomId: versionTwo.body.id, warehouseId: fixture.warehouse.id, plannedQuantity: 2 },
    });
    assert.equal(order.status, 201, JSON.stringify(order.body));
    const started = await api(`/manufacturing/orders/${order.body.id}/start`, { method: "POST", token, companyId: fixture.company.id, body: {} });
    assert.equal(started.status, 201, JSON.stringify(started.body));
    const completed = await api(`/manufacturing/orders/${order.body.id}/complete`, {
      method: "POST",
      token,
      companyId: fixture.company.id,
      body: {
        producedQuantity: 2,
        acceptedQuantity: 2,
        actualMaterials: [{ productId: raw.body.id, actualQuantity: 2 }],
        overheadItems: [{ type: "ELECTRICITY", amount: 5, description: "Flow power" }],
        packaging: [{ quantity: 1, packSize: 1, packUnit: "kg", materials: [{ productId: bag.body.id, quantity: 1 }] }],
        completionNote: "Flow complete",
      },
    });
    assert.equal(completed.status, 201, JSON.stringify(completed.body));
    assert.equal(Number(completed.body.actualQuantity), 2);
    assert.equal(Number(completed.body.yieldPercent), 100);
    assert.equal(Number(completed.body.remainingBulkQuantity), 1);
    assert.equal(completed.body.completionNote, "Flow complete");
    assert.equal(await prisma.product.count({ where: { companyId: fixture.company.id, parentProductId: output.body.id, isVariant: true } }), 1);

    const sale = await api("/sales/complete", {
      method: "POST",
      token,
      companyId: fixture.company.id,
      headers: { "idempotency-key": `flow-sale-${fixtureCounter}` },
      body: { warehouseId: fixture.warehouse.id, items: [{ productId: output.body.id, quantity: 1, price: 50 }], payments: [{ method: "CASH", amount: 50 }] },
    });
    assert.equal(sale.status, 201, JSON.stringify(sale.body));
    assert.ok(Number(sale.body.cogs) >= 0);
  });

  test("payroll supports partial and final payments without duplicate finance rows", async () => {
    const fixture = await createFixture("payroll");
    const token = await login(fixture.user.email, fixture);
    const employee = await api("/employees", { method: "POST", token, companyId: fixture.company.id, body: { fullName: "Payroll Employee", salary: 4_300_000 } });
    assert.equal(employee.status, 201);
    const payroll = await api("/employees/payroll", { method: "POST", token, companyId: fixture.company.id, body: { employeeId: employee.body.id, period: "2026-08", netAmount: 4_300_000 } });
    assert.equal(payroll.status, 201);
    const firstKey = `payroll-first-${Date.now()}`;
    const partial = await api(`/employees/payroll/${payroll.body.id}/pay`, { method: "POST", token, companyId: fixture.company.id, body: { amount: 3_000_000, idempotencyKey: firstKey } });
    assert.equal(partial.status, 201);
    assert.equal(partial.body.status, "PARTIAL");
    assert.equal(Number(partial.body.debtAmount), 1_300_000);
    const duplicatePartial = await api(`/employees/payroll/${payroll.body.id}/pay`, { method: "POST", token, companyId: fixture.company.id, body: { amount: 3_000_000, idempotencyKey: firstKey } });
    assert.equal(duplicatePartial.status, 201);
    const final = await api(`/employees/payroll/${payroll.body.id}/pay`, { method: "POST", token, companyId: fixture.company.id, body: { amount: 1_300_000, idempotencyKey: `payroll-final-${Date.now()}` } });
    assert.equal(final.status, 201);
    assert.equal(final.body.status, "PAID");
    assert.equal(Number(final.body.debtAmount), 0);
    assert.equal(await prisma.financeTransaction.count({ where: { companyId: fixture.company.id, payrollId: payroll.body.id, type: "OUT" } }), 2);
  });
});

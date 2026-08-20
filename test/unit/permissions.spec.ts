import assert from "node:assert/strict";
import { test } from "node:test";

import { PermissionsGuard, inferBusinessPermission } from "../../src/common/guards/permissions.guard";

const contextFor = (user: any, method: string, path: string) => ({
  getHandler: () => function handler() {},
  getClass: () => class Controller {},
  switchToHttp: () => ({ getRequest: () => ({ user, method, path }) }),
}) as any;

test("business routes infer granular create permissions", () => {
  assert.equal(inferBusinessPermission({ method: "POST", path: "/api/suppliers" }), "suppliers.create");
  assert.equal(inferBusinessPermission({ method: "POST", path: "/api/categories" }), "categories.create");
  assert.equal(inferBusinessPermission({ method: "POST", path: "/api/customers" }), "customers.create");
  assert.equal(inferBusinessPermission({ method: "POST", path: "/api/sales/complete" }), "sales.create");
  assert.equal(inferBusinessPermission({ method: "POST", path: "/api/finance/transactions" }), "finance.create");
  assert.equal(inferBusinessPermission({ method: "GET", path: "/api/products" }), "products.view");
});

test("OWNER and ADMIN can perform normal business creates", () => {
  const guard = new PermissionsGuard();

  for (const role of ["OWNER", "ADMIN"]) {
    assert.equal(guard.canActivate(contextFor({ role, permissions: [] }, "POST", "/api/suppliers")), true);
  }
});

test("granular roles are allowed only when the create permission exists", () => {
  const guard = new PermissionsGuard();

  assert.equal(guard.canActivate(contextFor({ role: "MANAGER", permissions: ["suppliers.create"] }, "POST", "/api/suppliers")), true);
  assert.throws(() => guard.canActivate(contextFor({ role: "MANAGER", permissions: [] }, "POST", "/api/suppliers")), /Bu amal uchun ruxsat yo'q/);
  assert.equal(guard.canActivate(contextFor({ role: "CASHIER", permissions: ["customers.create"] }, "POST", "/api/customers")), true);
  assert.throws(() => guard.canActivate(contextFor({ role: "USER", permissions: [] }, "POST", "/api/products")), /Bu amal uchun ruxsat yo'q/);
});

test("SUPER_ADMIN retains platform-wide access", () => {
  const guard = new PermissionsGuard();
  assert.equal(guard.canActivate(contextFor({ role: "SUPER_ADMIN", permissions: [] }, "POST", "/api/suppliers")), true);
});

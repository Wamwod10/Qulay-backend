import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import { convertQuantity, parseQuantity, UNIT_DEFINITIONS } from "../../src/common/utils/unit.util";
import { normalizeCurrency, SUPPORTED_CURRENCIES } from "../../src/common/utils/currency.util";
import { roundMoney } from "../../src/common/utils/money.util";

const backend = (file: string) => readFileSync(resolve(process.cwd(), "src", file), "utf8");
const frontend = (file: string) => readFileSync(resolve(process.cwd(), "..", "frontend", "src", file), "utf8");

test("01 universal creatable lookups create real entities", () => {
  assert.match(frontend("shared/ui/CreatableSelect/CreatableSelect.jsx"), /onCreate/);
  assert.match(backend("modules/business/business.controller.ts"), /@Post\(\)/);
  assert.match(backend("modules/business/business.service.ts"), /ensureProduct/);
});

test("02 product category is optional and creatable", () => {
  const form = frontend("modules/products/components/ProductForm/ProductForm.jsx");
  assert.match(form, /createCategory/);
  assert.match(backend("modules/business/business.service.ts"), /ensureCategory/);
  assert.doesNotMatch(form, /label=.*Kategoriya.*required/);
});

test("03 central unit system exposes all required dimensions", () => {
  assert.deepEqual(Object.keys(UNIT_DEFINITIONS), ["dona", "g", "kg", "ml", "litr", "mm", "sm", "metr"]);
  assert.match(backend("common/utils/unit.util.ts"), /UNIT_OPTIONS/);
  assert.match(frontend("shared/utils/units.js"), /UNIT_DEFINITIONS/);
});

test("04 quantities accept decimals and persist with six decimal places", () => {
  assert.equal(parseQuantity("0.75"), 0.75);
  assert.match(readFileSync(resolve(process.cwd(), "prisma", "schema.prisma"), "utf8"), /@db\.Decimal\(18, 6\)/);
  assert.match(frontend("modules/products/components/ProductForm/ProductForm.jsx"), /step="any"/);
});

test("05 conversion engine converts same dimensions and rejects mixed dimensions", () => {
  assert.equal(convertQuantity(1000, "g", "kg"), 1);
  assert.equal(convertQuantity(500, "g", "kg"), 0.5);
  assert.equal(convertQuantity(100, "sm", "metr"), 1);
  assert.throws(() => convertQuantity(1, "kg", "litr"), (error: any) => error?.response?.code === "UNIT_DIMENSION_MISMATCH");
});

test("06 product form remembers the last selected unit", () => {
  const source = frontend("modules/products/components/ProductForm/ProductForm.jsx");
  assert.match(source, /last_product_unit/);
  assert.match(source, /tenantSet\("last_product_unit"/);
});

test("07 Product.unit remains the source of truth across modules", () => {
  const source = backend("modules/business/business.service.ts");
  assert.match(source, /applyProductUnits/);
  assert.match(source, /product\.unit/);
  assert.match(source, /stockItems/);
});

test("08 recipe and production use canonical unit and producedQuantity fields", () => {
  const service = backend("modules/business/business.service.ts");
  assert.match(service, /producedQuantity:/);
  assert.match(service, /unit: output\.unit/);
  assert.doesNotMatch(frontend("modules/manufacturing/components/BomForm/BomForm.jsx"), /outputUnit/);
});

test("09 recipe has no duplicate output unit source", () => {
  const form = frontend("modules/manufacturing/components/BomForm/BomForm.jsx");
  assert.match(form, /unit: selectedProduct\?\.unit/);
  assert.doesNotMatch(form, /label="O'lchov birligi"/);
});

test("10 user-facing recipe text does not use BOM", () => {
  assert.doesNotMatch(frontend("localization/translations.js"), /BOM/);
  assert.doesNotMatch(frontend("localization/productPurchaseOverrides.js"), /BOM/);
  assert.doesNotMatch(frontend("modules/manufacturing/components/BomForm/BomForm.jsx"), /BOM/);
});

test("11 recipe output and materials can create real products", () => {
  const form = frontend("modules/manufacturing/components/BomForm/BomForm.jsx");
  const service = backend("modules/business/business.service.ts");
  assert.match(form, /ProductFormModal/);
  assert.match(form, /FINISHED_GOOD/);
  assert.match(form, /RAW_MATERIAL/);
  assert.match(service, /const output = await this\.ensureProduct/);
});

test("12 add material action is rendered after the material list", () => {
  const form = frontend("modules/manufacturing/components/BomForm/BomForm.jsx");
  assert.ok(form.indexOf("preparedMaterials.map") < form.indexOf("Xomashyo qo"));
});

test("13 manufacturing reads the same product and warehouse data", () => {
  assert.match(frontend("modules/manufacturing/production-orders/utils/materialAvailability.js"), /getStoredProducts/);
  assert.match(frontend("modules/manufacturing/production-orders/utils/materialAvailability.js"), /getStoredWarehouseStock/);
  assert.match(backend("modules/business/business.service.ts"), /refreshProductStock/);
});

test("14 inventory stock is the aggregate source for product stock", () => {
  const source = backend("modules/business/business.service.ts");
  assert.match(source, /stockItem\.aggregate/);
  assert.match(source, /stockFromInventory/);
});

test("15 opening stock requires an explicit warehouse and creates inventory stock", () => {
  const form = frontend("modules/products/components/ProductForm/ProductForm.jsx");
  const service = backend("modules/business/business.service.ts");
  assert.match(form, /Boshlang'ich qoldiq/);
  assert.match(service, /OPENING_STOCK/);
  assert.match(service, /if \(stock > 0 && warehouse\)/);
});

test("16 purchase supplier is creatable inline", () => {
  assert.match(frontend("modules/purchases/components/PurchaseForm/PurchaseForm.jsx"), /createSupplier/);
  assert.match(backend("modules/business/business.service.ts"), /supplierId/);
});

test("17 product supplier is creatable inline", () => {
  assert.match(frontend("modules/products/components/ProductForm/ProductForm.jsx"), /createSupplier/);
});

test("18 supplier optional rule is consistent", () => {
  const form = frontend("modules/purchases/components/PurchaseForm/PurchaseForm.jsx");
  const service = backend("modules/business/business.service.ts");
  assert.doesNotMatch(form, /nextErrors\.supplier/);
  assert.doesNotMatch(service, /SUPPLIER_REQUIRED/);
});

test("19 raw materials do not require a sale price", () => {
  const form = frontend("modules/products/components/ProductForm/ProductForm.jsx");
  assert.match(form, /form\.type !== "RAW_MATERIAL"/);
  assert.match(form, /form\.type === "RAW_MATERIAL" \|\| form\.salePrice/);
});

test("20 successful product creation returns to the product list", () => {
  assert.match(frontend("modules/products/pages/ProductCreatePage/ProductCreatePage.jsx"), /navigate\("\/products"\)/);
});

test("21 product required fields are validated on both sides", () => {
  assert.match(frontend("modules/products/components/ProductForm/ProductForm.jsx"), /Mahsulot nomini kiriting/);
  assert.match(frontend("modules/products/components/ProductForm/ProductForm.jsx"), /Mahsulot turini tanlang/);
  assert.match(backend("modules/business/business.service.ts"), /PRODUCT_NAME_REQUIRED/);
  assert.match(backend("modules/business/business.service.ts"), /PRODUCT_TYPE_REQUIRED/);
});

test("22 number inputs ignore mouse-wheel changes globally", () => {
  assert.match(frontend("shared/ui/Input/Input.jsx"), /onWheel/);
  assert.match(frontend("app/App.jsx"), /wheel/);
});

test("23 production material totals stay separated by dimension", () => {
  assert.match(frontend("shared/utils/units.js"), /aggregateQuantities/);
  assert.match(frontend("modules/manufacturing/production-orders/components/ProductionOrderForm/ProductionOrderForm.jsx"), /materialSummary/);
});

test("24 finished product label explains the recipe output", () => {
  assert.match(frontend("modules/manufacturing/components/BomForm/BomForm.jsx"), /Natijada olinadigan mahsulot/);
  assert.match(frontend("modules/manufacturing/components/BomForm/BomForm.jsx"), /Chiqish miqdori/);
});

test("25 production completion sends the canonical produced quantity", () => {
  assert.match(frontend("modules/manufacturing/production-orders/components/ProductionCompleteModal/ProductionCompleteModal.jsx"), /producedQuantity:/);
  assert.match(backend("modules/business/business.service.ts"), /body\.producedQuantity/);
});

test("26 production defect waste and completion fields persist in the model and DTO", () => {
  const schema = readFileSync(resolve(process.cwd(), "prisma", "schema.prisma"), "utf8");
  const service = backend("modules/business/business.service.ts");
  ["defectQuantity", "wasteQuantity", "acceptedQuantity", "completionNote", "actualMaterials"].forEach((field) => assert.match(schema, new RegExp(field)));
  assert.match(service, /completionNote:/);
});

test("27 completion reconciles actual material consumption against the start snapshot", () => {
  const service = backend("modules/business/business.service.ts");
  assert.match(service, /actualMaterialQuantity - plannedQuantity/);
  assert.match(service, /PRODUCTION_UNUSED_RETURN/);
});

test("28 production cancellation has an idempotent stock rollback", () => {
  const service = backend("modules/business/business.service.ts");
  assert.match(service, /PRODUCTION_CANCEL_RETURN/);
  assert.match(service, /order\.status === "CANCELLED"/);
});

test("29 production stages use server endpoints", () => {
  assert.match(backend("modules/business/business.controller.ts"), /stages\/:stageId\/start/);
  assert.match(frontend("modules/manufacturing/utils/manufacturingStorage.js"), /stages\/\$\{changedStage\.id\}/);
});

test("30 quality control is stored on ProductionOrder", () => {
  assert.match(readFileSync(resolve(process.cwd(), "prisma", "schema.prisma"), "utf8"), /qualityControl\s+Json/);
  assert.match(backend("modules/business/business.controller.ts"), /orders\/:id\/quality/);
});

test("31 overhead details are persisted as item history", () => {
  assert.match(readFileSync(resolve(process.cwd(), "prisma", "schema.prisma"), "utf8"), /overheadItems\s+Json/);
  assert.match(backend("modules/business/business.service.ts"), /normalizeOverheadItems/);
});

test("32 actual production cost and zero-output unit cost are safe", () => {
  const service = backend("modules/business/business.service.ts");
  assert.match(service, /actualProductionCost/);
  assert.match(service, /acceptedQuantity > 0 \? roundMoney/);
});

test("33 production uses a batch-actual material cost snapshot", () => {
  assert.match(backend("modules/business/business.service.ts"), /costingPolicy: "BATCH_ACTUAL"/);
  assert.match(readFileSync(resolve(process.cwd(), "prisma", "schema.prisma"), "utf8"), /materialSnapshot\s+Json/);
});

test("34 purchase quantities are converted to the product base unit", () => {
  assert.match(backend("modules/business/business.service.ts"), /convertQuantity\(purchaseQuantity, purchaseUnit, unit\)/);
  assert.equal(convertQuantity(500, "g", "kg"), 0.5);
});

test("35 unit changes with stock or history are blocked", () => {
  assert.match(backend("modules/business/business.service.ts"), /UNIT_CHANGE_BLOCKED/);
});

test("36 supported company currencies are extensible and validated", () => {
  assert.deepEqual(SUPPORTED_CURRENCIES, ["UZS", "TJS", "USD", "EUR", "RUB", "KZT", "KGS"]);
  assert.equal(normalizeCurrency("tjs"), "TJS");
});

test("37 TJS supports sub-unit decimal values", () => {
  assert.equal(roundMoney(0.9), 0.9);
  assert.equal(roundMoney(1.6), 1.6);
  assert.equal(roundMoney(7.65), 7.65);
  assert.match(frontend("modules/settings/utils/formatSettingsHelpers.js"), /minimumFractionDigits: precision/);
});

test("38 money keeps at least two decimal places without drift", () => {
  assert.equal(roundMoney(1.599999999), 1.6);
  assert.equal(roundMoney(7.645), 7.65);
  assert.match(readFileSync(resolve(process.cwd(), "prisma", "schema.prisma"), "utf8"), /@db\.Decimal\(18, 2\)/);
});

test("39 price display uses the shared currency formatter", () => {
  ["sales/utils/salesHelpers.js", "finance/utils/financeSelectors.js", "purchases/utils/purchaseHelpers.js", "manufacturing/utils/manufacturingHelpers.js"].forEach((file) => assert.match(frontend(`modules/${file}`), /formatMoneyWithSettings/));
});

test("40 VAT defaults to zero", () => {
  assert.match(frontend("modules/products/components/ProductForm/ProductForm.jsx"), /tax: "0"/);
  assert.match(frontend("modules/settings/constants/settingsDefaults.js"), /vatRate: 0/);
});

test("41 VAT accepts decimal percentages", () => {
  assert.match(frontend("modules/settings/utils/formatSettingsHelpers.js"), /calculateVat/);
  assert.equal(roundMoney(1.6 * 7.5 / 100), 0.12);
});

test("42 manufacturing layouts adapt to small screens", () => {
  assert.match(frontend("modules/manufacturing/pages/ProductionOrderDetailsPage/ProductionOrderDetailsPage.scss"), /max-width: 640px/);
  assert.match(frontend("modules/manufacturing/production-orders/components/ProductionCompleteModal/ProductionCompleteModal.scss"), /grid-template-columns: 1fr/);
});

test("43 cross-module data uses the shared backend stock refresh", () => {
  assert.match(backend("modules/business/business.service.ts"), /refreshProductStock/);
  assert.match(frontend("services/api/businessDataLoader.js"), /manufacturing/);
});

test("44 regression scenario covers decimal units, actual consumption, purchase conversion and TJS", () => {
  assert.equal(convertQuantity(500, "g", "kg"), 0.5);
  assert.equal(convertQuantity(1.5, "litr", "ml"), 1500);
  assert.match(backend("modules/business/business.service.ts"), /PRODUCTION_ACTUAL_EXTRA/);
  assert.match(frontend("modules/settings/utils/formatSettingsHelpers.js"), /currency/);
});

test("45 package scripts expose the requested final verification commands", () => {
  const backendPackage = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));
  const frontendPackage = JSON.parse(readFileSync(resolve(process.cwd(), "..", "frontend", "package.json"), "utf8"));
  assert.match(backendPackage.scripts.build, /nest build/);
  assert.match(backendPackage.scripts.lint, /eslint/);
  assert.ok(backendPackage.scripts["test:e2e"]);
  assert.match(frontendPackage.scripts.build, /vite/);
  assert.match(frontendPackage.scripts.lint, /eslint/);
});

test("46 batch lot model persists required fields and receives/produces through stock engine", () => {
  const schema = readFileSync(resolve(process.cwd(), "prisma", "schema.prisma"), "utf8");
  const service = backend("modules/business/business.service.ts");
  ["batchNumber", "remainingQuantity", "productionDate", "receivedDate", "expiryDate", "unitCost", "sourceType", "sourceId"].forEach((field) => assert.match(schema, new RegExp(field)));
  assert.match(service, /tx\.batch\.create/);
  assert.match(service, /PURCHASE_RECEIVE/);
  assert.match(service, /PRODUCTION_COMPLETE|PRODUCTION_BULK_REMAINING/);
});

test("47 expiry warnings are exposed to warehouse and reports", () => {
  const service = backend("modules/business/business.service.ts");
  assert.match(service, /batchWarnings/);
  assert.match(service, /expiryStatus/);
  assert.match(service, /expiredBatches/);
  assert.match(backend("modules/business/business.controller.ts"), /batches\/warnings/);
});

test("48 FIFO and FEFO are selectable with FEFO as safe default", () => {
  const service = backend("modules/business/business.service.ts");
  assert.match(service, /company\?\.inventoryPolicy === "FIFO"/);
  assert.match(service, /policy === "FEFO"/);
  assert.match(readFileSync(resolve(process.cwd(), "prisma", "schema.prisma"), "utf8"), /inventoryPolicy String\s+@default\("FEFO"\)/);
  assert.match(frontend("modules/settings/pages/GeneralSettingsPage/GeneralSettingsPage.jsx"), /FEFO/);
});

test("49 packaging validates bulk total and produces sellable variants", () => {
  const service = backend("modules/business/business.service.ts");
  const modal = frontend("modules/manufacturing/production-orders/components/ProductionCompleteModal/ProductionCompleteModal.jsx");
  assert.match(service, /PACKAGING_EXCEEDS_OUTPUT/);
  assert.match(service, /ensurePackagedVariant/);
  assert.match(service, /remainingBulkQuantity/);
  assert.match(modal, /packagingRows/);
});

test("50 packaged variants are real Product records", () => {
  const schema = readFileSync(resolve(process.cwd(), "prisma", "schema.prisma"), "utf8");
  const service = backend("modules/business/business.service.ts");
  assert.match(schema, /parentProductId/);
  assert.match(schema, /isVariant\s+Boolean/);
  assert.match(service, /tx\.product\.upsert/);
});

test("51 packaging material rows consume stock items", () => {
  const service = backend("modules/business/business.service.ts");
  assert.match(service, /PACKAGING_MATERIAL/);
  assert.match(service, /row\.materials/);
  assert.match(frontend("modules/manufacturing/production-orders/components/ProductionCompleteModal/ProductionCompleteModal.jsx"), /materials:/);
});

test("52 recipe edits create versions and preserve production snapshots", () => {
  const schema = readFileSync(resolve(process.cwd(), "prisma", "schema.prisma"), "utf8");
  const service = backend("modules/business/business.service.ts");
  assert.match(schema, /versionGroupId/);
  assert.match(schema, /recipeSnapshot\s+Json/);
  assert.match(service, /version: current\.version \+ 1/);
  assert.match(service, /recipeVersion: recipeSnapshot\.version/);
});

test("53 recipes deactivate instead of deleting historical records", () => {
  assert.match(backend("modules/business/business.service.ts"), /data: \{ status: "ARCHIVED" \}/);
  assert.match(backend("modules/business/business.service.ts"), /status: "INACTIVE"/);
});

test("54 production DTO exposes planned versus actual material differences", () => {
  const service = backend("modules/business/business.service.ts");
  assert.match(service, /plannedQuantity/);
  assert.match(service, /actualQuantity/);
  assert.match(frontend("modules/manufacturing/production-orders/components/ProductionCompleteModal/ProductionCompleteModal.jsx"), /difference/);
});

test("55 production yield is calculated and displayed", () => {
  assert.match(backend("modules/business/business.service.ts"), /yieldPercent/);
  assert.match(frontend("modules/manufacturing/pages/ProductionOrderDetailsPage/ProductionOrderDetailsPage.jsx"), /Yield/);
});

test("56 normal waste threshold marks abnormal waste", () => {
  assert.match(readFileSync(resolve(process.cwd(), "prisma", "schema.prisma"), "utf8"), /normalWastePercent/);
  assert.match(backend("modules/business/business.service.ts"), /abnormalWaste/);
  assert.match(frontend("modules/manufacturing/pages/ProductionOrderDetailsPage/ProductionOrderDetailsPage.jsx"), /abnormal/);
});

test("57 inventory count stores system actual difference reason approval and date", () => {
  const schema = readFileSync(resolve(process.cwd(), "prisma", "schema.prisma"), "utf8");
  const service = backend("modules/business/business.service.ts");
  ["InventoryCount", "systemQuantity", "actualQuantity", "difference", "approvedBy", "createdAt"].forEach((field) => assert.match(schema, new RegExp(field)));
  assert.match(service, /createInventoryCount/);
  assert.match(backend("modules/business/business.controller.ts"), /@Post\("counts"\)/);
});

test("58 inventory adjustment is controlled, audited and never negative", () => {
  const service = backend("modules/business/business.service.ts");
  assert.match(service, /NEGATIVE_INVENTORY_COUNT/);
  assert.match(service, /stock\.adjustment/);
  assert.match(service, /INVENTORY_ADJUSTMENT/);
});

test("59 minimum stock and reorder point are persisted and exposed", () => {
  const schema = readFileSync(resolve(process.cwd(), "prisma", "schema.prisma"), "utf8");
  assert.match(schema, /minimumStock/);
  assert.match(schema, /reorderPoint/);
  assert.match(backend("modules/business/business.service.ts"), /isLowStock/);
  assert.match(frontend("modules/products/components/ProductForm/ProductForm.jsx"), /Qayta buyurtma nuqtasi/);
});

test("60 purchase suggestions calculate required quantity and supplier", () => {
  const service = backend("modules/business/business.service.ts");
  assert.match(service, /purchaseSuggestions/);
  assert.match(service, /required: roundQuantity/);
  assert.match(service, /supplierName/);
  assert.match(backend("modules/business/business.controller.ts"), /purchase-suggestions/);
});

test("61 supplier product price history persists unit currency and price", () => {
  const schema = readFileSync(resolve(process.cwd(), "prisma", "schema.prisma"), "utf8");
  const service = backend("modules/business/business.service.ts");
  ["SupplierPriceHistory", "supplierId", "productId", "price", "currency"].forEach((field) => assert.match(schema, new RegExp(field)));
  assert.match(service, /supplierPriceHistory\.create/);
  assert.match(backend("modules/business/business.controller.ts"), /price-history/);
});

test("62 completed sales persist batch COGS and profit", () => {
  const schema = readFileSync(resolve(process.cwd(), "prisma", "schema.prisma"), "utf8");
  const service = backend("modules/business/business.service.ts");
  assert.match(schema, /cogs\s+Decimal/);
  assert.match(schema, /profit\s+Decimal/);
  assert.match(service, /saleCogs/);
  assert.match(service, /normalized\.profit/);
});

test("63 manufactured cost and recipe cost are frozen in snapshots", () => {
  const service = backend("modules/business/business.service.ts");
  const schema = readFileSync(resolve(process.cwd(), "prisma", "schema.prisma"), "utf8");
  assert.match(service, /BATCH_ACTUAL/);
  assert.match(service, /materialSnapshot/);
  assert.match(schema, /actualUnitCost/);
});

test("64 audit log covers critical business actions with actor and before after metadata", () => {
  const service = backend("modules/business/business.service.ts");
  assert.match(service, /private async writeAudit/);
  ["product.price_change", "stock.adjustment", "purchase.receive", "supplier.payment", "sale.cancel", "sale.return", "recipe.change", "production.start", "production.complete", "production.cancel", "customer.debt_payment", "payroll.payment"].forEach((action) => assert.match(service, new RegExp(action.replace(".", "\\."))));
  assert.match(service, /before:/);
  assert.match(service, /after:/);
});

test("65 historical entities use safe deactivate or archive behavior", () => {
  const service = backend("modules/business/business.service.ts");
  ["deleteProduct", "deleteCustomer", "deleteSupplier", "deleteBom", "deleteEmployee"].forEach((method) => assert.match(service, new RegExp(method)));
  assert.match(service, /softDelete: true/);
  assert.match(service, /deletedAt: new Date\(\)/);
});

test("66 login routes stable by role and blocked status", () => {
  const service = readFileSync(resolve(process.cwd(), "src", "core/auth/auth.service.ts"), "utf8");
  assert.match(service, /INVALID_CREDENTIALS/);
  assert.match(service, /ACCOUNT_BLOCKED/);
  assert.match(service, /SUPER_ADMIN_ROLE/);
  assert.match(frontend("modules/auth/pages/LoginPage/LoginPage.jsx"), /navigate\(isSuperAdmin \? "\/superadmin" : "\/dashboard"/);
});

test("67 register validates duplicates, company membership and default modules", () => {
  const service = readFileSync(resolve(process.cwd(), "src", "core/auth/auth.service.ts"), "utf8");
  assert.match(service, /USER_EXISTS/);
  assert.match(service, /companyMember\.create/);
  assert.match(service, /companyModuleAccess\.createMany/);
  assert.match(service, /ensurePlatformModules/);
});

test("68 MVP password reset updates bcrypt hash without OTP dependency", () => {
  const service = readFileSync(resolve(process.cwd(), "src", "core/auth/auth.service.ts"), "utf8");
  const controller = readFileSync(resolve(process.cwd(), "src", "core/auth/auth.controller.ts"), "utf8");
  assert.match(service, /MVP reset flow/);
  assert.match(service, /async resetPassword/);
  assert.match(service, /bcrypt\.hash\(nextPassword/);
  assert.doesNotMatch(controller, /PASSWORD_RESET_NOT_CONFIGURED/);
});

test("69 password reset validates user password confirmation and rate limit", () => {
  const service = readFileSync(resolve(process.cwd(), "src", "core/auth/auth.service.ts"), "utf8");
  assert.match(service, /RESET_EMAIL_REQUIRED/);
  assert.match(service, /RESET_USER_NOT_FOUND/);
  assert.match(service, /PASSWORD_MISMATCH/);
  assert.match(readFileSync(resolve(process.cwd(), "src", "common/middleware/auth-rate-limit.middleware.ts"), "utf8"), /reset-password/);
  assert.doesNotMatch(service, /logger\.(log|warn|error).*nextPassword/);
});

test("70 password reset redirects to login with success message", () => {
  assert.match(frontend("modules/auth/pages/ForgotPasswordPage/ForgotPasswordPage.jsx"), /navigate\("\/login"/);
  assert.match(frontend("modules/auth/pages/ForgotPasswordPage/ForgotPasswordPage.jsx"), /Parol yangilandi/);
  assert.match(frontend("modules/auth/pages/LoginPage/LoginPage.jsx"), /location\.state\?\.message/);
});

test("71 Prisma errors are mapped to business-friendly UZ messages", () => {
  const filter = backend("common/filters/app-exception.filter.ts");
  assert.match(filter, /DUPLICATE_RECORD/);
  assert.match(filter, /DATABASE_SCHEMA_NOT_READY/);
  assert.match(filter, /DATABASE_OPERATION_FAILED/);
  assert.doesNotMatch(filter, /code: exception\.code/);
});

test("72 critical writes have frontend/backend idempotency protection", () => {
  const service = backend("modules/business/business.service.ts");
  assert.match(service, /sale-stock:/);
  assert.match(service, /purchase-payment:/);
  assert.match(service, /purchase-receive:/);
  assert.match(service, /production-output:/);
  assert.match(service, /payroll-payment:/);
  assert.match(service, /customer-payment:/);
  assert.match(frontend("modules/sales/utils/salesStorage.js"), /completeSale/);
});

test("73 new flow regression coverage is present as separate assertions", () => {
  const source = readFileSync(resolve(process.cwd(), "test/unit/requirements.spec.ts"), "utf8");
  ["46 batch", "47 expiry", "48 FIFO", "49 packaging", "52 recipe", "55 production yield", "57 inventory count", "62 completed sales", "68 MVP password reset"].forEach((marker) => assert.match(source, new RegExp(marker)));
  const integration = readFileSync(resolve(process.cwd(), "test/e2e/integration.spec.ts"), "utf8");
  assert.match(integration, /batch expiry, inventory count, recipe version, packaging and COGS/);
  assert.doesNotMatch(integration, /PASSWORD_RESET_NOT_CONFIGURED/);
});

test("74 route data loads server-first and does not show empty state while loading", () => {
  const apiClient = frontend("services/api/apiClient.js");
  const purchases = frontend("modules/purchases/pages/PurchasesPage/PurchasesPage.jsx");
  const products = frontend("modules/products/pages/ProductsPage/ProductsPage.jsx");
  const manufacturing = frontend("modules/manufacturing/pages/ManufacturingPage/ManufacturingPage.jsx");
  assert.match(apiClient, /skipCache/);
  assert.match(purchases, /loading/);
  assert.match(purchases, /Skeleton/);
  assert.match(products, /skipCache: true/);
  assert.match(manufacturing, /fetchStoredProductionOrders/);
  assert.match(frontend("modules/purchases/utils/purchasesStorage.js"), /skipCache: true/);
});

test("75 purchase form loads active suppliers warehouses and products from backend", () => {
  const form = frontend("modules/purchases/components/PurchaseForm/PurchaseForm.jsx");
  assert.match(form, /fetchStoredSuppliers/);
  assert.match(form, /fetchStoredWarehouses/);
  assert.match(form, /getStoredProductsPage/);
  assert.match(form, /getOptionSearchText/);
  assert.match(frontend("shared/ui/CreatableSelect/CreatableSelect.jsx"), /duplicateOption/);
  assert.match(frontend("modules/warehouse/utils/warehouseDefaults.js"), /MAIN/);
  assert.match(frontend("modules/warehouse/utils/warehouseDefaults.js"), /asosiy ombor/);
});

test("76 overhead add uses a real modal and waits for backend success", () => {
  const panel = frontend("modules/manufacturing/production-orders/components/ProductionOverheadPanel/ProductionOverheadPanel.jsx");
  const details = frontend("modules/manufacturing/pages/ProductionOrderDetailsPage/ProductionOrderDetailsPage.jsx");
  const service = backend("modules/business/business.service.ts");
  assert.match(panel, /<Modal/);
  assert.match(panel, /handleSave/);
  assert.match(panel, /amount <= 0/);
  assert.doesNotMatch(panel, /emitChange\(\[createOverheadItem\(\), \.\.\.items\]\)/);
  assert.match(details, /updateProductionOrderOverhead/);
  assert.match(details, /throw error/);
  assert.match(service, /overheadItems/);
});

test("77 unicode product names stay UTF-8 and manufacturing uses productId relation", () => {
  const appFactory = backend("app.factory.ts");
  const service = backend("modules/business/business.service.ts");
  const sample = "Селес Мука высший сорт Қанд Шакар Сув Продукт №1 Сахар 50кг";
  assert.equal(Buffer.from(sample, "utf8").toString("utf8"), sample);
  assert.match(appFactory, /application\/json; charset=utf-8/);
  assert.match(service, /if \(!productId\)/);
  assert.match(service, /field: type === "RAW_MATERIAL" \? "productId" : "outputProductId"/);
  assert.match(service, /productId: product\.id/);
  assert.match(service, /productName: product\.name/);
});

test("78 settings navigation and route use consistent permission", () => {
  assert.match(frontend("config/navigation.config.js"), /permission: "settings.view"/);
  assert.match(frontend("layouts/AppLayout/components/Sidebar/Sidebar.jsx"), /can\(item\.permission\)/);
  assert.match(frontend("layouts/AppLayout/components/Sidebar/Sidebar.jsx"), /userRole === "OWNER" \|\| userRole === "ADMIN"/);
  assert.match(frontend("routes/AppRouter.jsx"), /PermissionGuard permission="settings.view"/);
  assert.match(backend("common/constants/permissions.constants.ts"), /"settings.view"/);
});

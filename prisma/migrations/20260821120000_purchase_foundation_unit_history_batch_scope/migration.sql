-- Supplier price history keeps purchase-unit trace data while preserving
-- the existing canonical unit/price fields for older rows.
ALTER TABLE "SupplierPriceHistory"
ADD COLUMN "purchaseUnit" TEXT,
ADD COLUMN "purchaseQuantity" DECIMAL(18,6),
ADD COLUMN "canonicalUnit" TEXT,
ADD COLUMN "canonicalUnitPrice" DECIMAL(18,6);

ALTER TABLE "PurchaseItem"
ALTER COLUMN "cost" TYPE DECIMAL(18,6);

UPDATE "SupplierPriceHistory"
SET "canonicalUnit" = "unit",
    "canonicalUnitPrice" = "price"
WHERE "canonicalUnit" IS NULL
   OR "canonicalUnitPrice" IS NULL;

-- Batch numbers are unique only inside the actual stock identity scope.
-- This allows the same supplier/lot label to exist for different products
-- or warehouses without breaking receive.
ALTER TABLE "Batch" DROP CONSTRAINT IF EXISTS "Batch_companyId_batchNumber_key";

CREATE UNIQUE INDEX IF NOT EXISTS "Batch_companyId_batchNumber_productId_warehouseId_key"
ON "Batch"("companyId", "batchNumber", "productId", "warehouseId");

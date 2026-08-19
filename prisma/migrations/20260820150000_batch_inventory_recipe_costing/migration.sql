ALTER TABLE "Company" ADD COLUMN "inventoryPolicy" TEXT NOT NULL DEFAULT 'FEFO';

ALTER TABLE "Product"
  ADD COLUMN "reorderPoint" DECIMAL(18,6) NOT NULL DEFAULT 0,
  ADD COLUMN "expiryDate" TIMESTAMP(3),
  ADD COLUMN "normalWastePercent" DECIMAL(9,4),
  ADD COLUMN "parentProductId" TEXT,
  ADD COLUMN "packSize" DECIMAL(18,6),
  ADD COLUMN "packUnit" TEXT,
  ADD COLUMN "isVariant" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "StockMovement" ADD COLUMN "batchId" TEXT;
ALTER TABLE "Sale" ADD COLUMN "cogs" DECIMAL(18,6) NOT NULL DEFAULT 0, ADD COLUMN "profit" DECIMAL(18,6) NOT NULL DEFAULT 0;
ALTER TABLE "SaleItem" ADD COLUMN "cogs" DECIMAL(18,6) NOT NULL DEFAULT 0;

ALTER TABLE "Bom"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "versionGroupId" TEXT,
  ADD COLUMN "normalWastePercent" DECIMAL(9,4);

ALTER TABLE "ProductionOrder"
  ADD COLUMN "yieldPercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
  ADD COLUMN "wastePercent" DECIMAL(9,4) NOT NULL DEFAULT 0,
  ADD COLUMN "recipeVersion" INTEGER,
  ADD COLUMN "recipeSnapshot" JSONB,
  ADD COLUMN "packaging" JSONB,
  ADD COLUMN "remainingBulkQuantity" DECIMAL(18,6) NOT NULL DEFAULT 0;

CREATE TABLE "Batch" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "batchNumber" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "quantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "remainingQuantity" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "productionDate" TIMESTAMP(3),
  "receivedDate" TIMESTAMP(3),
  "expiryDate" TIMESTAMP(3),
  "unitCost" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT,
  "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BatchConsumption" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "quantity" DECIMAL(18,6) NOT NULL,
  "unitCost" DECIMAL(18,6) NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "idempotencyKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BatchConsumption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryCount" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "systemQuantity" DECIMAL(18,6) NOT NULL,
  "actualQuantity" DECIMAL(18,6) NOT NULL,
  "difference" DECIMAL(18,6) NOT NULL,
  "reason" TEXT NOT NULL,
  "approvedBy" TEXT,
  "adjustmentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryCount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplierPriceHistory" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "supplierId" TEXT,
  "productId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "unit" TEXT NOT NULL,
  "price" DECIMAL(18,6) NOT NULL,
  "currency" TEXT NOT NULL,
  "sourceType" TEXT,
  "sourceId" TEXT,
  CONSTRAINT "SupplierPriceHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Batch_companyId_batchNumber_key" ON "Batch"("companyId", "batchNumber");
CREATE INDEX "Batch_companyId_productId_warehouseId_idx" ON "Batch"("companyId", "productId", "warehouseId");
CREATE INDEX "Batch_companyId_expiryDate_idx" ON "Batch"("companyId", "expiryDate");
CREATE INDEX "Batch_companyId_receivedDate_idx" ON "Batch"("companyId", "receivedDate");
CREATE UNIQUE INDEX "BatchConsumption_companyId_idempotencyKey_key" ON "BatchConsumption"("companyId", "idempotencyKey");
CREATE INDEX "BatchConsumption_companyId_productId_warehouseId_idx" ON "BatchConsumption"("companyId", "productId", "warehouseId");
CREATE INDEX "BatchConsumption_sourceType_sourceId_idx" ON "BatchConsumption"("sourceType", "sourceId");
CREATE INDEX "InventoryCount_companyId_warehouseId_productId_idx" ON "InventoryCount"("companyId", "warehouseId", "productId");
CREATE INDEX "InventoryCount_createdAt_idx" ON "InventoryCount"("createdAt");
CREATE INDEX "SupplierPriceHistory_companyId_productId_date_idx" ON "SupplierPriceHistory"("companyId", "productId", "date");
CREATE INDEX "SupplierPriceHistory_supplierId_productId_idx" ON "SupplierPriceHistory"("supplierId", "productId");
CREATE INDEX "StockMovement_batchId_idx" ON "StockMovement"("batchId");
CREATE INDEX "Product_parentProductId_idx" ON "Product"("parentProductId");
CREATE INDEX "Bom_companyId_versionGroupId_idx" ON "Bom"("companyId", "versionGroupId");

ALTER TABLE "Product" ADD CONSTRAINT "Product_parentProductId_fkey" FOREIGN KEY ("parentProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BatchConsumption" ADD CONSTRAINT "BatchConsumption_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BatchConsumption" ADD CONSTRAINT "BatchConsumption_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryCount" ADD CONSTRAINT "InventoryCount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryCount" ADD CONSTRAINT "InventoryCount_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierPriceHistory" ADD CONSTRAINT "SupplierPriceHistory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierPriceHistory" ADD CONSTRAINT "SupplierPriceHistory_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplierPriceHistory" ADD CONSTRAINT "SupplierPriceHistory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

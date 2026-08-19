CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Product" ADD COLUMN "categoryId" TEXT;
ALTER TABLE "ProductionOrder" ADD COLUMN "unit" TEXT NOT NULL DEFAULT 'dona';

CREATE UNIQUE INDEX "Category_companyId_name_key" ON "Category"("companyId", "name");
CREATE INDEX "Category_companyId_status_idx" ON "Category"("companyId", "status");
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

ALTER TABLE "Category" ADD CONSTRAINT "Category_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Product" ALTER COLUMN "stock" TYPE DECIMAL(18,6), ALTER COLUMN "minimumStock" TYPE DECIMAL(18,6);
ALTER TABLE "StockItem" ALTER COLUMN "quantity" TYPE DECIMAL(18,6), ALTER COLUMN "reserved" TYPE DECIMAL(18,6), ALTER COLUMN "minimumStock" TYPE DECIMAL(18,6);
ALTER TABLE "StockMovement" ALTER COLUMN "quantity" TYPE DECIMAL(18,6);
ALTER TABLE "PurchaseItem" ALTER COLUMN "quantity" TYPE DECIMAL(18,6), ALTER COLUMN "receivedQuantity" TYPE DECIMAL(18,6);
ALTER TABLE "SaleItem" ALTER COLUMN "quantity" TYPE DECIMAL(18,6);
ALTER TABLE "SaleReturn" ALTER COLUMN "quantity" TYPE DECIMAL(18,6);
ALTER TABLE "Bom" ALTER COLUMN "outputQuantity" TYPE DECIMAL(18,6);
ALTER TABLE "BomMaterial" ALTER COLUMN "quantity" TYPE DECIMAL(18,6);
ALTER TABLE "ProductionOrder" ALTER COLUMN "plannedQuantity" TYPE DECIMAL(18,6), ALTER COLUMN "actualQuantity" TYPE DECIMAL(18,6);

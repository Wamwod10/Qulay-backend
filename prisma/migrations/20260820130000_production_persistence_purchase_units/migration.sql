ALTER TABLE "PurchaseItem" ADD COLUMN "purchaseQuantity" DECIMAL(18,6);
ALTER TABLE "PurchaseItem" ADD COLUMN "purchaseUnit" TEXT;

ALTER TABLE "ProductionOrder" ADD COLUMN "acceptedQuantity" DECIMAL(18,6) NOT NULL DEFAULT 0;
ALTER TABLE "ProductionOrder" ADD COLUMN "defectQuantity" DECIMAL(18,6) NOT NULL DEFAULT 0;
ALTER TABLE "ProductionOrder" ADD COLUMN "wasteQuantity" DECIMAL(18,6) NOT NULL DEFAULT 0;
ALTER TABLE "ProductionOrder" ADD COLUMN "actualMaterialCost" DECIMAL(18,6) NOT NULL DEFAULT 0;
ALTER TABLE "ProductionOrder" ADD COLUMN "actualProductionCost" DECIMAL(18,6) NOT NULL DEFAULT 0;
ALTER TABLE "ProductionOrder" ADD COLUMN "actualUnitCost" DECIMAL(18,6) NOT NULL DEFAULT 0;
ALTER TABLE "ProductionOrder" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'UZS';
ALTER TABLE "ProductionOrder" ADD COLUMN "costingPolicy" TEXT NOT NULL DEFAULT 'CURRENT_AT_START';
ALTER TABLE "ProductionOrder" ADD COLUMN "materialSnapshot" JSONB;
ALTER TABLE "ProductionOrder" ADD COLUMN "actualMaterials" JSONB;
ALTER TABLE "ProductionOrder" ADD COLUMN "overheadItems" JSONB;
ALTER TABLE "ProductionOrder" ADD COLUMN "qualityControl" JSONB;
ALTER TABLE "ProductionOrder" ADD COLUMN "qualityStatus" TEXT;
ALTER TABLE "ProductionOrder" ADD COLUMN "qualityNote" TEXT;
ALTER TABLE "ProductionOrder" ADD COLUMN "completionNote" TEXT;

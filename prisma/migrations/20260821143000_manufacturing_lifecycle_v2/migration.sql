-- Manufacturing lifecycle v2 fields are additive for existing production orders.
ALTER TABLE "ProductionOrder" ADD COLUMN "materialWarehouseId" TEXT;
ALTER TABLE "ProductionOrder" ADD COLUMN "outputWarehouseId" TEXT;
ALTER TABLE "ProductionOrder" ADD COLUMN "plannedDate" TIMESTAMP(3);
ALTER TABLE "ProductionOrder" ADD COLUMN "dueDate" TIMESTAMP(3);
ALTER TABLE "ProductionOrder" ADD COLUMN "priority" TEXT;
ALTER TABLE "ProductionOrder" ADD COLUMN "responsible" TEXT;

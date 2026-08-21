ALTER TABLE "ProductionStage" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (PARTITION BY "orderId" ORDER BY "id") - 1 AS "position"
  FROM "ProductionStage"
)
UPDATE "ProductionStage"
SET "sortOrder" = ranked."position"
FROM ranked
WHERE "ProductionStage"."id" = ranked."id";

CREATE INDEX "ProductionStage_orderId_sortOrder_idx" ON "ProductionStage"("orderId", "sortOrder");

-- Persist the last successful FX table so a backend restart does not lose rates.
CREATE TABLE "FxRateCache" (
    "id" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "rates" JSONB NOT NULL,
    "provider" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "effectiveAt" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FxRateCache_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FxRateCache_baseCurrency_key" ON "FxRateCache"("baseCurrency");
CREATE INDEX "FxRateCache_expiresAt_idx" ON "FxRateCache"("expiresAt");

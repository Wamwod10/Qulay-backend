-- The platform now has one canonical currency: Tajikistan somoni (TJS).
-- Existing numeric amounts are retained and their currency metadata is normalized.
ALTER TABLE "Company" ALTER COLUMN "currency" SET DEFAULT 'TJS';
ALTER TABLE "Purchase" ALTER COLUMN "currency" SET DEFAULT 'TJS';
ALTER TABLE "Cashbox" ALTER COLUMN "currency" SET DEFAULT 'TJS';
ALTER TABLE "ProductionOrder" ALTER COLUMN "currency" SET DEFAULT 'TJS';
ALTER TABLE "SupplierPriceHistory" ALTER COLUMN "currency" SET DEFAULT 'TJS';

UPDATE "Company" SET "currency" = 'TJS' WHERE "currency" <> 'TJS' OR "currency" IS NULL;
UPDATE "Purchase" SET "currency" = 'TJS' WHERE "currency" <> 'TJS' OR "currency" IS NULL;
UPDATE "Cashbox" SET "currency" = 'TJS' WHERE "currency" <> 'TJS' OR "currency" IS NULL;
UPDATE "ProductionOrder" SET "currency" = 'TJS' WHERE "currency" <> 'TJS' OR "currency" IS NULL;
UPDATE "SupplierPriceHistory" SET "currency" = 'TJS' WHERE "currency" <> 'TJS' OR "currency" IS NULL;

-- Normalize saved format/default settings so old browser and server preferences
-- cannot switch the interface back to another currency.
UPDATE "CompanySetting"
SET "value" = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE("value"::text,
  'UZS', 'TJS'), 'USD', 'TJS'), 'EUR', 'TJS'), 'RUB', 'TJS'), 'KZT', 'TJS'), 'KGS', 'TJS')::jsonb
WHERE "value"::text ~ '(UZS|USD|EUR|RUB|KZT|KGS)';

UPDATE "UserSetting"
SET "value" = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE("value"::text,
  'UZS', 'TJS'), 'USD', 'TJS'), 'EUR', 'TJS'), 'RUB', 'TJS'), 'KZT', 'TJS'), 'KGS', 'TJS')::jsonb
WHERE "value"::text ~ '(UZS|USD|EUR|RUB|KZT|KGS)';

DELETE FROM "FxRateCache";

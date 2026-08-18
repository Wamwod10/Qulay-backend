-- Final audit: barcode must be unique inside a company while nullable barcodes remain allowed.
CREATE UNIQUE INDEX "Product_companyId_barcode_key"
ON "Product"("companyId", "barcode");

-- CreateTable
CREATE TABLE "product_country_score_snapshots" (
    "id" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "datasetVersion" TEXT NOT NULL,
    "opportunityScore" INTEGER NOT NULL,
    "confidence" INTEGER NOT NULL,
    "components" JSONB NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_country_score_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_country_score_snapshots_productCode_countryCode_cap_idx" ON "product_country_score_snapshots"("productCode", "countryCode", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "product_country_score_snapshots_productCode_countryCode_dat_key" ON "product_country_score_snapshots"("productCode", "countryCode", "datasetVersion");

-- CreateTable
CREATE TABLE "product_intelligence_snapshots" (
    "id" TEXT NOT NULL,
    "datasetKey" TEXT NOT NULL,
    "datasetVersion" TEXT NOT NULL,
    "codeSystem" "CodeSystem" NOT NULL,
    "code" TEXT NOT NULL,
    "sourceType" "OpportunitySourceType" NOT NULL,
    "sourceName" TEXT NOT NULL,
    "opportunityScore" INTEGER NOT NULL,
    "confidence" INTEGER NOT NULL,
    "components" JSONB NOT NULL,
    "payload" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_intelligence_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_intelligence_snapshots_code_idx" ON "product_intelligence_snapshots"("code");

-- CreateIndex
CREATE UNIQUE INDEX "product_intelligence_snapshots_datasetKey_datasetVersion_key" ON "product_intelligence_snapshots"("datasetKey", "datasetVersion");

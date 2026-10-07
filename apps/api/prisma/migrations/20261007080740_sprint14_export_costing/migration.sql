-- CreateEnum
CREATE TYPE "CostingStatus" AS ENUM ('DRAFT', 'READY', 'LOCKED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CostCategory" AS ENUM ('PROCUREMENT', 'PACKAGING', 'INLAND_TRANSPORT', 'INSPECTION', 'CHA', 'CUSTOMS', 'PORT', 'FREIGHT', 'INSURANCE', 'BANKING', 'CERTIFICATES', 'MISCELLANEOUS');

-- CreateEnum
CREATE TYPE "CostBasis" AS ENUM ('FIXED', 'PER_UNIT', 'PER_KG', 'PER_MT', 'PER_CARTON', 'PER_CONTAINER', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "PercentageBase" AS ENUM ('PROCUREMENT_VALUE', 'PRE_INSURANCE_COST');

-- CreateEnum
CREATE TYPE "CostSourceType" AS ENUM ('USER_ENTERED', 'SUPPLIER_QUOTE', 'FREIGHT_QUOTE', 'SYSTEM_DERIVED', 'PUBLIC_DATA', 'IMPORTED', 'DEMO');

-- CreateEnum
CREATE TYPE "CostConfidence" AS ENUM ('CONFIRMED', 'ESTIMATE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "FreightQuoteType" AS ENUM ('MANUAL_ESTIMATE', 'FORWARDER_QUOTE', 'PROVIDER_RATE', 'ACTUAL');

-- CreateEnum
CREATE TYPE "TransportMode" AS ENUM ('SEA', 'AIR', 'ROAD', 'RAIL', 'MULTIMODAL', 'OTHER');

-- CreateEnum
CREATE TYPE "Incoterm" AS ENUM ('EXW', 'FCA', 'FOB', 'CFR', 'CIF');

-- CreateEnum
CREATE TYPE "CostingQuantityUnit" AS ENUM ('KG', 'MT', 'UNIT', 'CARTON', 'CONTAINER');

-- CreateEnum
CREATE TYPE "PricingMode" AS ENUM ('MARGIN', 'MARKUP', 'TARGET_PRICE');

-- CreateEnum
CREATE TYPE "FxSourceType" AS ENUM ('MANUAL', 'PUBLIC_API', 'COMMERCIAL_PROVIDER', 'BANK_RATE', 'DEMO');

-- CreateEnum
CREATE TYPE "CostingSnapshotKind" AS ENUM ('READY', 'LOCKED');

-- CreateTable
CREATE TABLE "fx_rate_snapshots" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "quoteCurrency" TEXT NOT NULL,
    "rate" DECIMAL(24,10) NOT NULL,
    "sourceType" "FxSourceType" NOT NULL DEFAULT 'MANUAL',
    "sourceLabel" TEXT,
    "sourceDate" TIMESTAMP(3) NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isManual" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,

    CONSTRAINT "fx_rate_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_costings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CostingStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "rootId" TEXT,
    "revisionOfId" TEXT,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "productId" TEXT,
    "buyerCompanyId" TEXT,
    "crmLeadId" TEXT,
    "destinationCountryCode" TEXT,
    "calculationCurrency" TEXT NOT NULL DEFAULT 'INR',
    "quoteCurrency" TEXT NOT NULL DEFAULT 'USD',
    "thinMarginPercent" DECIMAL(6,2) NOT NULL DEFAULT 8,
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "readyAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "lockedByUserId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "export_costings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "costing_scenarios" (
    "id" TEXT NOT NULL,
    "costingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isBase" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "quantity" DECIMAL(20,4) NOT NULL,
    "quantityUnit" "CostingQuantityUnit" NOT NULL,
    "netWeightKg" DECIMAL(20,4),
    "cartonCount" DECIMAL(20,4),
    "containerCount" DECIMAL(20,4),
    "incoterm" "Incoterm" NOT NULL DEFAULT 'FOB',
    "incotermPlace" TEXT,
    "originPort" TEXT,
    "destinationPort" TEXT,
    "transportMode" "TransportMode",
    "supplierLabel" TEXT,
    "pricingMode" "PricingMode" NOT NULL DEFAULT 'MARGIN',
    "pricingValue" DECIMAL(20,6),
    "buyerTargetPrice" DECIMAL(20,6),
    "notes" TEXT,
    "result" JSONB,
    "calculatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "costing_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "costing_scenario_fx" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,

    CONSTRAINT "costing_scenario_fx_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "costing_line_items" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "category" "CostCategory" NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(20,6),
    "currency" TEXT NOT NULL,
    "basis" "CostBasis" NOT NULL DEFAULT 'FIXED',
    "percentageBase" "PercentageBase",
    "wastagePercent" DECIMAL(8,4),
    "sourceType" "CostSourceType" NOT NULL DEFAULT 'USER_ENTERED',
    "confidence" "CostConfidence" NOT NULL DEFAULT 'ESTIMATE',
    "freightQuoteType" "FreightQuoteType",
    "quoteReference" TEXT,
    "carrier" TEXT,
    "transitDays" INTEGER,
    "quoteDate" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "routeNotes" TEXT,
    "notes" TEXT,
    "includeOverride" BOOLEAN,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "costing_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "costing_snapshots" (
    "id" TEXT NOT NULL,
    "costingId" TEXT NOT NULL,
    "kind" "CostingSnapshotKind" NOT NULL,
    "formulaVersion" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "results" JSONB NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "costing_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fx_rate_snapshots_organizationId_baseCurrency_quoteCurrency_idx" ON "fx_rate_snapshots"("organizationId", "baseCurrency", "quoteCurrency", "capturedAt");

-- CreateIndex
CREATE INDEX "export_costings_organizationId_status_idx" ON "export_costings"("organizationId", "status");

-- CreateIndex
CREATE INDEX "export_costings_organizationId_updatedAt_idx" ON "export_costings"("organizationId", "updatedAt");

-- CreateIndex
CREATE INDEX "export_costings_organizationId_productId_idx" ON "export_costings"("organizationId", "productId");

-- CreateIndex
CREATE INDEX "export_costings_organizationId_buyerCompanyId_idx" ON "export_costings"("organizationId", "buyerCompanyId");

-- CreateIndex
CREATE INDEX "export_costings_organizationId_crmLeadId_idx" ON "export_costings"("organizationId", "crmLeadId");

-- CreateIndex
CREATE UNIQUE INDEX "export_costings_organizationId_reference_key" ON "export_costings"("organizationId", "reference");

-- CreateIndex
CREATE INDEX "costing_scenarios_costingId_idx" ON "costing_scenarios"("costingId");

-- CreateIndex
CREATE UNIQUE INDEX "costing_scenario_fx_scenarioId_currency_key" ON "costing_scenario_fx"("scenarioId", "currency");

-- CreateIndex
CREATE INDEX "costing_line_items_scenarioId_idx" ON "costing_line_items"("scenarioId");

-- CreateIndex
CREATE INDEX "costing_snapshots_costingId_idx" ON "costing_snapshots"("costingId");

-- AddForeignKey
ALTER TABLE "fx_rate_snapshots" ADD CONSTRAINT "fx_rate_snapshots_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_costings" ADD CONSTRAINT "export_costings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_costings" ADD CONSTRAINT "export_costings_productId_fkey" FOREIGN KEY ("productId") REFERENCES "organization_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_costings" ADD CONSTRAINT "export_costings_buyerCompanyId_fkey" FOREIGN KEY ("buyerCompanyId") REFERENCES "buyer_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_costings" ADD CONSTRAINT "export_costings_crmLeadId_fkey" FOREIGN KEY ("crmLeadId") REFERENCES "buyer_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "costing_scenarios" ADD CONSTRAINT "costing_scenarios_costingId_fkey" FOREIGN KEY ("costingId") REFERENCES "export_costings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "costing_scenario_fx" ADD CONSTRAINT "costing_scenario_fx_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "costing_scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "costing_scenario_fx" ADD CONSTRAINT "costing_scenario_fx_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "fx_rate_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "costing_line_items" ADD CONSTRAINT "costing_line_items_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "costing_scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "costing_snapshots" ADD CONSTRAINT "costing_snapshots_costingId_fkey" FOREIGN KEY ("costingId") REFERENCES "export_costings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

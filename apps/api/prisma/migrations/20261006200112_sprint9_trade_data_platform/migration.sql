-- CreateEnum
CREATE TYPE "TradeDataSourceType" AS ENUM ('GOVERNMENT', 'INTERGOVERNMENTAL', 'PUBLIC', 'COMMERCIAL', 'INTERNAL', 'DEMO');

-- CreateEnum
CREATE TYPE "DataAccessMethod" AS ENUM ('API', 'CSV', 'XLSX', 'JSON', 'ZIP', 'MANUAL_IMPORT');

-- CreateEnum
CREATE TYPE "SourceQualityTier" AS ENUM ('A', 'B', 'C', 'D', 'DEMO');

-- CreateEnum
CREATE TYPE "UpdateFrequency" AS ENUM ('DAILY', 'MONTHLY', 'QUARTERLY', 'ANNUAL', 'AD_HOC', 'STATIC');

-- CreateEnum
CREATE TYPE "IngestionRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "IngestionMode" AS ENUM ('API', 'MANUAL_IMPORT', 'REFERENCE');

-- CreateEnum
CREATE TYPE "PeriodType" AS ENUM ('YEAR', 'QUARTER', 'MONTH');

-- CreateEnum
CREATE TYPE "PartnerEntityType" AS ENUM ('COUNTRY', 'WORLD', 'AGGREGATE', 'OTHER');

-- CreateEnum
CREATE TYPE "MappingStatus" AS ENUM ('EXACT', 'HIGH_CONFIDENCE', 'APPROXIMATE', 'UNRESOLVED');

-- CreateEnum
CREATE TYPE "TradeDataIssueSeverity" AS ENUM ('REJECTED', 'UNRESOLVED', 'WARNING');

-- AlterEnum
ALTER TYPE "FreshnessStatus" ADD VALUE 'VERY_STALE';

-- CreateTable
CREATE TABLE "trade_data_sources" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "authority" TEXT NOT NULL,
    "sourceType" "TradeDataSourceType" NOT NULL,
    "accessMethod" "DataAccessMethod" NOT NULL,
    "baseUrl" TEXT,
    "termsUrl" TEXT,
    "description" TEXT NOT NULL,
    "countryCode" TEXT,
    "dataDomains" TEXT[],
    "updateFrequency" "UpdateFrequency" NOT NULL,
    "expectedLagDays" INTEGER NOT NULL,
    "qualityTier" "SourceQualityTier" NOT NULL,
    "official" BOOLEAN NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "lastSuccessfulRunAt" TIMESTAMP(3),
    "latestSourcePeriod" TEXT,
    "latestPeriodEnd" TIMESTAMP(3),
    "nextExpectedRefreshAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trade_data_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_data_ingestion_runs" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" "IngestionRunStatus" NOT NULL DEFAULT 'PENDING',
    "mode" "IngestionMode" NOT NULL,
    "datasetKeys" TEXT[],
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "recordsFetched" INTEGER NOT NULL DEFAULT 0,
    "recordsAccepted" INTEGER NOT NULL DEFAULT 0,
    "recordsRejected" INTEGER NOT NULL DEFAULT 0,
    "recordsInserted" INTEGER NOT NULL DEFAULT 0,
    "recordsUpdated" INTEGER NOT NULL DEFAULT 0,
    "duplicatesSkipped" INTEGER NOT NULL DEFAULT 0,
    "unresolvedMappings" INTEGER NOT NULL DEFAULT 0,
    "qualityScore" INTEGER,
    "checkpoint" JSONB,
    "sourceVersion" TEXT,
    "transformVersion" TEXT NOT NULL,
    "fileName" TEXT,
    "fileChecksum" TEXT,
    "storageKey" TEXT,
    "errorSummary" TEXT,
    "initiatedByUserId" TEXT,
    "organizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_data_ingestion_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_data_raw_records" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "ingestionRunId" TEXT NOT NULL,
    "datasetKey" TEXT NOT NULL,
    "sourceRecordKey" TEXT,
    "payload" JSONB NOT NULL,
    "sourcePeriod" TEXT,
    "sourceUpdatedAt" TIMESTAMP(3),
    "checksum" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_data_raw_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_facts" (
    "id" TEXT NOT NULL,
    "factKey" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "sourceId" TEXT NOT NULL,
    "ingestionRunId" TEXT NOT NULL,
    "rawRecordId" TEXT,
    "sourceRecordKey" TEXT,
    "datasetKey" TEXT NOT NULL,
    "tradeDirection" "TradeDirection" NOT NULL,
    "codeSystem" "CodeSystem" NOT NULL,
    "hsCode" TEXT NOT NULL,
    "hsLevel" INTEGER NOT NULL,
    "sourceHsCode" TEXT NOT NULL,
    "reporterCountryCode" TEXT NOT NULL,
    "partnerCountryCode" TEXT,
    "partnerEntityType" "PartnerEntityType" NOT NULL,
    "sourcePartner" TEXT,
    "partnerLabel" TEXT NOT NULL,
    "periodType" "PeriodType" NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "tradeValue" DECIMAL(20,2),
    "currency" TEXT NOT NULL,
    "valueBasis" TEXT,
    "normalizedValueUsd" DECIMAL(20,2),
    "fxRate" DECIMAL(18,8),
    "fxRateDate" TIMESTAMP(3),
    "fxSource" TEXT,
    "quantity" DECIMAL(24,4),
    "quantityUnit" TEXT,
    "normalizedQuantity" DECIMAL(24,4),
    "normalizedUnit" TEXT,
    "unitMappingStatus" "MappingStatus" NOT NULL,
    "netWeightKg" DECIMAL(24,4),
    "portCode" TEXT,
    "stateCode" TEXT,
    "districtKey" TEXT,
    "districtLabel" TEXT,
    "districtMappingStatus" "MappingStatus",
    "isEstimated" BOOLEAN,
    "sourceUpdatedAt" TIMESTAMP(3),
    "transformVersion" TEXT NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trade_facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_data_issues" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" "TradeDataIssueSeverity" NOT NULL,
    "field" TEXT,
    "sourceValue" TEXT,
    "message" TEXT NOT NULL,
    "rowRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_data_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trade_data_sources_code_key" ON "trade_data_sources"("code");

-- CreateIndex
CREATE INDEX "trade_data_ingestion_runs_sourceId_createdAt_idx" ON "trade_data_ingestion_runs"("sourceId", "createdAt");

-- CreateIndex
CREATE INDEX "trade_data_ingestion_runs_sourceId_fileChecksum_idx" ON "trade_data_ingestion_runs"("sourceId", "fileChecksum");

-- CreateIndex
CREATE INDEX "trade_data_raw_records_sourceId_datasetKey_checksum_idx" ON "trade_data_raw_records"("sourceId", "datasetKey", "checksum");

-- CreateIndex
CREATE UNIQUE INDEX "trade_facts_factKey_key" ON "trade_facts"("factKey");

-- CreateIndex
CREATE INDEX "trade_facts_hsCode_tradeDirection_reporterCountryCode_year_idx" ON "trade_facts"("hsCode", "tradeDirection", "reporterCountryCode", "year");

-- CreateIndex
CREATE INDEX "trade_facts_reporterCountryCode_partnerCountryCode_hsCode_y_idx" ON "trade_facts"("reporterCountryCode", "partnerCountryCode", "hsCode", "year");

-- CreateIndex
CREATE INDEX "trade_facts_sourceId_idx" ON "trade_facts"("sourceId");

-- CreateIndex
CREATE INDEX "trade_data_issues_runId_idx" ON "trade_data_issues"("runId");

-- CreateIndex
CREATE INDEX "trade_data_issues_sourceId_kind_idx" ON "trade_data_issues"("sourceId", "kind");

-- AddForeignKey
ALTER TABLE "trade_data_ingestion_runs" ADD CONSTRAINT "trade_data_ingestion_runs_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "trade_data_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_data_raw_records" ADD CONSTRAINT "trade_data_raw_records_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "trade_data_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_data_raw_records" ADD CONSTRAINT "trade_data_raw_records_ingestionRunId_fkey" FOREIGN KEY ("ingestionRunId") REFERENCES "trade_data_ingestion_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_facts" ADD CONSTRAINT "trade_facts_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "trade_data_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_facts" ADD CONSTRAINT "trade_facts_ingestionRunId_fkey" FOREIGN KEY ("ingestionRunId") REFERENCES "trade_data_ingestion_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_facts" ADD CONSTRAINT "trade_facts_rawRecordId_fkey" FOREIGN KEY ("rawRecordId") REFERENCES "trade_data_raw_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_data_issues" ADD CONSTRAINT "trade_data_issues_runId_fkey" FOREIGN KEY ("runId") REFERENCES "trade_data_ingestion_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_data_issues" ADD CONSTRAINT "trade_data_issues_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "trade_data_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "document_extractions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tradeDocumentId" TEXT NOT NULL,
    "documentVersion" INTEGER NOT NULL,
    "extractionVersion" INTEGER NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "providerType" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "providerModel" TEXT,
    "promptVersion" TEXT,
    "schemaVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "textAvailability" TEXT NOT NULL,
    "detectedDocumentType" TEXT,
    "documentTypeConfidence" TEXT,
    "result" JSONB,
    "rawStructuredOutput" JSONB,
    "overallConfidence" INTEGER,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_extractions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_confirmed_data" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tradeDocumentId" TEXT NOT NULL,
    "documentVersion" INTEGER NOT NULL,
    "extractionId" TEXT,
    "confirmedDocumentType" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "correctionCount" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "reviewedByUserId" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_confirmed_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_validation_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runNumber" INTEGER NOT NULL,
    "scope" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "primaryDocumentId" TEXT,
    "documentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "documents" JSONB NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "resultSummary" JSONB NOT NULL,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "infoCount" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signedOffByUserId" TEXT,
    "signedOffAt" TIMESTAMP(3),
    "signoffNote" TEXT,
    "signoffUnresolvedWarnings" INTEGER,
    "signoffUnresolvedCritical" INTEGER,
    "signoffOverrideReason" TEXT,
    "rejectedByUserId" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,

    CONSTRAINT "document_validation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_validation_findings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "itemReference" TEXT,
    "sourceDocumentId" TEXT,
    "sourceLabel" TEXT NOT NULL,
    "referenceDocumentId" TEXT,
    "referenceLabel" TEXT,
    "sourceField" TEXT,
    "referenceField" TEXT,
    "rule" TEXT NOT NULL,
    "expectedValue" TEXT,
    "actualValue" TEXT,
    "normalizedExpected" TEXT,
    "normalizedActual" TEXT,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolutionNote" TEXT,
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "carriedFromRun" INTEGER,

    CONSTRAINT "document_validation_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_validation_comments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "findingId" TEXT,
    "body" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_validation_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_extractions_organizationId_cacheKey_idx" ON "document_extractions"("organizationId", "cacheKey");

-- CreateIndex
CREATE UNIQUE INDEX "document_extractions_tradeDocumentId_extractionVersion_key" ON "document_extractions"("tradeDocumentId", "extractionVersion");

-- CreateIndex
CREATE INDEX "document_confirmed_data_tradeDocumentId_idx" ON "document_confirmed_data"("tradeDocumentId");

-- CreateIndex
CREATE INDEX "document_confirmed_data_organizationId_idx" ON "document_confirmed_data"("organizationId");

-- CreateIndex
CREATE INDEX "document_validation_runs_organizationId_purchaseOrderId_idx" ON "document_validation_runs"("organizationId", "purchaseOrderId");

-- CreateIndex
CREATE INDEX "document_validation_runs_organizationId_primaryDocumentId_idx" ON "document_validation_runs"("organizationId", "primaryDocumentId");

-- CreateIndex
CREATE INDEX "document_validation_findings_organizationId_idx" ON "document_validation_findings"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "document_validation_findings_runId_signature_key" ON "document_validation_findings"("runId", "signature");

-- CreateIndex
CREATE INDEX "document_validation_comments_runId_idx" ON "document_validation_comments"("runId");

-- AddForeignKey
ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_tradeDocumentId_fkey" FOREIGN KEY ("tradeDocumentId") REFERENCES "trade_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_confirmed_data" ADD CONSTRAINT "document_confirmed_data_tradeDocumentId_fkey" FOREIGN KEY ("tradeDocumentId") REFERENCES "trade_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_confirmed_data" ADD CONSTRAINT "document_confirmed_data_extractionId_fkey" FOREIGN KEY ("extractionId") REFERENCES "document_extractions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_validation_runs" ADD CONSTRAINT "document_validation_runs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_validation_findings" ADD CONSTRAINT "document_validation_findings_runId_fkey" FOREIGN KEY ("runId") REFERENCES "document_validation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_validation_comments" ADD CONSTRAINT "document_validation_comments_runId_fkey" FOREIGN KEY ("runId") REFERENCES "document_validation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_validation_comments" ADD CONSTRAINT "document_validation_comments_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "document_validation_findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "compliance_rules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "requirementType" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "tradeDirection" TEXT NOT NULL DEFAULT 'EXPORT',
    "countryCode" TEXT,
    "productCategory" TEXT,
    "hsPrefixes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "conditionJson" JSONB,
    "satisfiedBy" JSONB NOT NULL,
    "documentTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "responsibleParty" TEXT NOT NULL DEFAULT 'EXPORTER',
    "sourceType" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceDate" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "confidence" TEXT NOT NULL DEFAULT 'MEDIUM',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_checklists" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "quotationId" TEXT,
    "provisional" BOOLEAN NOT NULL DEFAULT false,
    "context" JSONB NOT NULL,
    "coverage" JSONB NOT NULL,
    "readiness" TEXT NOT NULL DEFAULT 'NOT_READY',
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evaluatedByUserId" TEXT,
    "readyReadiness" TEXT,
    "readyAt" TIMESTAMP(3),
    "readyByUserId" TEXT,
    "readyNote" TEXT,
    "readySnapshot" JSONB,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_checklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_requirement_instances" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "checklistId" TEXT NOT NULL,
    "ruleId" TEXT,
    "ruleCode" TEXT NOT NULL,
    "ruleVersion" INTEGER NOT NULL,
    "ruleSnapshot" JSONB NOT NULL,
    "productKey" TEXT NOT NULL DEFAULT '',
    "productId" TEXT,
    "productLabel" TEXT,
    "countryCode" TEXT,
    "applicability" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "explanation" TEXT NOT NULL,
    "evidenceDocumentId" TEXT,
    "notes" TEXT,
    "dueDate" TIMESTAMP(3),
    "overrideKind" TEXT,
    "overrideReason" TEXT,
    "overriddenByUserId" TEXT,
    "overriddenAt" TIMESTAMP(3),
    "manualNote" TEXT,
    "manualByUserId" TEXT,
    "manualAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_requirement_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_documents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rootId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "previousVersionId" TEXT,
    "revisionReason" TEXT,
    "documentType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "documentNumber" TEXT,
    "source" TEXT NOT NULL,
    "responsibleParty" TEXT NOT NULL DEFAULT 'EXPORTER',
    "status" TEXT NOT NULL,
    "generated" BOOLEAN NOT NULL DEFAULT false,
    "buyerCompanyId" TEXT,
    "purchaseOrderId" TEXT,
    "quotationId" TEXT,
    "proformaInvoiceId" TEXT,
    "inquiryId" TEXT,
    "productId" TEXT,
    "countryCode" TEXT,
    "issuer" TEXT,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "notes" TEXT,
    "internalNotes" TEXT,
    "storageKey" TEXT,
    "originalFilename" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "checksum" TEXT,
    "content" JSONB,
    "snapshot" JSONB,
    "totals" JSONB,
    "overrideReason" TEXT,
    "overrideByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "archivedAt" TIMESTAMP(3),
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trade_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "footer" TEXT,
    "terms" TEXT,
    "declaration" TEXT,
    "signatureLabel" TEXT,
    "expiryWarningDays" INTEGER NOT NULL DEFAULT 30,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "compliance_rules_organizationId_idx" ON "compliance_rules"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_rules_code_version_key" ON "compliance_rules"("code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_checklists_purchaseOrderId_key" ON "compliance_checklists"("purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_checklists_quotationId_key" ON "compliance_checklists"("quotationId");

-- CreateIndex
CREATE INDEX "compliance_checklists_organizationId_readiness_idx" ON "compliance_checklists"("organizationId", "readiness");

-- CreateIndex
CREATE INDEX "compliance_requirement_instances_organizationId_idx" ON "compliance_requirement_instances"("organizationId");

-- CreateIndex
CREATE INDEX "compliance_requirement_instances_evidenceDocumentId_idx" ON "compliance_requirement_instances"("evidenceDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_requirement_instances_checklistId_ruleCode_produ_key" ON "compliance_requirement_instances"("checklistId", "ruleCode", "productKey");

-- CreateIndex
CREATE INDEX "trade_documents_organizationId_documentType_idx" ON "trade_documents"("organizationId", "documentType");

-- CreateIndex
CREATE INDEX "trade_documents_organizationId_purchaseOrderId_idx" ON "trade_documents"("organizationId", "purchaseOrderId");

-- CreateIndex
CREATE INDEX "trade_documents_organizationId_checksum_idx" ON "trade_documents"("organizationId", "checksum");

-- CreateIndex
CREATE INDEX "trade_documents_rootId_idx" ON "trade_documents"("rootId");

-- CreateIndex
CREATE UNIQUE INDEX "trade_documents_organizationId_documentType_documentNumber__key" ON "trade_documents"("organizationId", "documentType", "documentNumber", "version");

-- CreateIndex
CREATE UNIQUE INDEX "document_templates_organizationId_documentType_key" ON "document_templates"("organizationId", "documentType");

-- AddForeignKey
ALTER TABLE "compliance_rules" ADD CONSTRAINT "compliance_rules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_checklists" ADD CONSTRAINT "compliance_checklists_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_requirement_instances" ADD CONSTRAINT "compliance_requirement_instances_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "compliance_checklists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_requirement_instances" ADD CONSTRAINT "compliance_requirement_instances_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "compliance_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_documents" ADD CONSTRAINT "trade_documents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

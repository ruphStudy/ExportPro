-- CreateTable
CREATE TABLE "finance_settings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reportingCurrency" TEXT NOT NULL DEFAULT 'INR',
    "dueSoonDays" INTEGER NOT NULL DEFAULT 7,
    "reorderLeadDays" INTEGER NOT NULL DEFAULT 7,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "finance_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivables" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "receivableNumber" TEXT NOT NULL,
    "buyerCompanyId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "shipmentId" TEXT,
    "proformaInvoiceId" TEXT,
    "quotationId" TEXT,
    "commercialInvoiceId" TEXT,
    "crmLeadId" TEXT,
    "destinationCountry" TEXT,
    "currency" TEXT NOT NULL,
    "totalAmount" DECIMAL(20,2) NOT NULL,
    "paidAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "outstandingAmount" DECIMAL(20,2) NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'OPEN',
    "paymentTermsType" TEXT NOT NULL,
    "paymentTermsText" TEXT,
    "paymentTermsSnapshot" JSONB NOT NULL,
    "customConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "invoiceDate" TIMESTAMPTZ(3),
    "termDays" INTEGER,
    "documentsPresentedAt" TIMESTAMPTZ(3),
    "collectingBank" TEXT,
    "acceptedAt" TIMESTAMPTZ(3),
    "tenorDays" INTEGER,
    "paymentReceivedAt" TIMESTAMPTZ(3),
    "bookingFx" JSONB,
    "disputeAmount" DECIMAL(20,2),
    "disputeReason" TEXT,
    "disputeNotes" TEXT,
    "disputedAt" TIMESTAMPTZ(3),
    "uncollectibleReason" TEXT,
    "uncollectibleAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "ownerUserId" TEXT,
    "notes" TEXT,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "receivables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivable_installments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "receivableId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "percentage" DECIMAL(8,4),
    "amount" DECIMAL(20,2) NOT NULL,
    "triggerType" TEXT NOT NULL,
    "dueDays" INTEGER,
    "fixedDate" TIMESTAMPTZ(3),
    "paidAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "outstandingAmount" DECIMAL(20,2) NOT NULL,
    "disputeAmount" DECIMAL(20,2),
    "disputeReason" TEXT,
    "disputeNotes" TEXT,
    "disputedAt" TIMESTAMPTZ(3),

    CONSTRAINT "receivable_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_receipts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "receivableId" TEXT NOT NULL,
    "installmentId" TEXT,
    "amount" DECIMAL(20,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "bankReference" TEXT,
    "remittanceReference" TEXT,
    "referenceKey" TEXT,
    "bankName" TEXT,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "fxRate" DECIMAL(24,10),
    "fxSourceLabel" TEXT,
    "fxSourceDate" TIMESTAMPTZ(3),
    "fxSnapshotId" TEXT,
    "appliedAmount" DECIMAL(20,2) NOT NULL,
    "excessAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "overpaymentReason" TEXT,
    "allocations" JSONB NOT NULL,
    "settlementFxRate" DECIMAL(24,10),
    "settlementFxSource" TEXT,
    "settlementFxDate" TIMESTAMPTZ(3),
    "charges" JSONB,
    "status" TEXT NOT NULL DEFAULT 'RECORDED',
    "reversalReason" TEXT,
    "reversedByUserId" TEXT,
    "reversedAt" TIMESTAMPTZ(3),
    "recordedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "letters_of_credit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "receivableId" TEXT NOT NULL,
    "lcNumber" TEXT NOT NULL,
    "issuingBank" TEXT NOT NULL,
    "advisingBank" TEXT,
    "amount" DECIMAL(20,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "issueDate" TIMESTAMPTZ(3),
    "expiryDate" TIMESTAMPTZ(3),
    "latestShipmentDate" TIMESTAMPTZ(3),
    "presentationDeadline" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "documents" JSONB,
    "notes" TEXT,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "letters_of_credit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivable_reminders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "receivableId" TEXT NOT NULL,
    "installmentId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "dueAmount" DECIMAL(20,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "dueDate" TIMESTAMPTZ(3),
    "channel" TEXT,
    "recordedSentAt" TIMESTAMPTZ(3),
    "recordedByUserId" TEXT,
    "dismissedAt" TIMESTAMPTZ(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receivable_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_actual_costs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "fxRate" DECIMAL(24,10),
    "fxSourceLabel" TEXT,
    "fxSourceDate" TIMESTAMPTZ(3),
    "fxSnapshotId" TEXT,
    "reportingCurrency" TEXT NOT NULL,
    "convertedAmount" DECIMAL(20,2) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceReference" TEXT,
    "incurredAt" TIMESTAMPTZ(3),
    "vendorName" TEXT,
    "attachmentKey" TEXT,
    "attachmentName" TEXT,
    "attachmentMime" TEXT,
    "attachmentSize" INTEGER,
    "voidedAt" TIMESTAMPTZ(3),
    "voidReason" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shipment_actual_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profitability_adjustments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profitability_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_profitability" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "finalized" BOOLEAN NOT NULL DEFAULT false,
    "finalizedAt" TIMESTAMPTZ(3),
    "finalizedByUserId" TEXT,
    "currentSnapshotId" TEXT,
    "confirmedNone" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reopenedAt" TIMESTAMPTZ(3),
    "reopenedByUserId" TEXT,
    "reopenReason" TEXT,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shipment_profitability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profitability_snapshots" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "profitabilityId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "finalizedByUserId" TEXT NOT NULL,
    "finalizedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMPTZ(3),
    "reopenReason" TEXT,

    CONSTRAINT "profitability_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reorder_reminders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "buyerCompanyId" TEXT NOT NULL,
    "productId" TEXT,
    "productName" TEXT,
    "windowStart" TIMESTAMPTZ(3) NOT NULL,
    "windowEnd" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUGGESTED',
    "snoozedUntil" TIMESTAMPTZ(3),
    "message" TEXT NOT NULL,
    "basis" JSONB NOT NULL,
    "dismissReason" TEXT,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reorder_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "finance_settings_organizationId_key" ON "finance_settings"("organizationId");

-- CreateIndex
CREATE INDEX "receivables_organizationId_state_idx" ON "receivables"("organizationId", "state");

-- CreateIndex
CREATE INDEX "receivables_organizationId_purchaseOrderId_idx" ON "receivables"("organizationId", "purchaseOrderId");

-- CreateIndex
CREATE INDEX "receivables_organizationId_buyerCompanyId_idx" ON "receivables"("organizationId", "buyerCompanyId");

-- CreateIndex
CREATE INDEX "receivables_organizationId_shipmentId_idx" ON "receivables"("organizationId", "shipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "receivables_organizationId_receivableNumber_key" ON "receivables"("organizationId", "receivableNumber");

-- CreateIndex
CREATE UNIQUE INDEX "receivable_installments_receivableId_sequence_key" ON "receivable_installments"("receivableId", "sequence");

-- CreateIndex
CREATE INDEX "payment_receipts_organizationId_receivedAt_idx" ON "payment_receipts"("organizationId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_receipts_receivableId_referenceKey_key" ON "payment_receipts"("receivableId", "referenceKey");

-- CreateIndex
CREATE UNIQUE INDEX "letters_of_credit_receivableId_key" ON "letters_of_credit"("receivableId");

-- CreateIndex
CREATE INDEX "receivable_reminders_organizationId_status_idx" ON "receivable_reminders"("organizationId", "status");

-- CreateIndex
CREATE INDEX "shipment_actual_costs_organizationId_shipmentId_idx" ON "shipment_actual_costs"("organizationId", "shipmentId");

-- CreateIndex
CREATE INDEX "profitability_adjustments_organizationId_shipmentId_idx" ON "profitability_adjustments"("organizationId", "shipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_profitability_shipmentId_key" ON "shipment_profitability"("shipmentId");

-- CreateIndex
CREATE INDEX "shipment_profitability_organizationId_finalized_idx" ON "shipment_profitability"("organizationId", "finalized");

-- CreateIndex
CREATE UNIQUE INDEX "profitability_snapshots_profitabilityId_version_key" ON "profitability_snapshots"("profitabilityId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "reorder_reminders_organizationId_buyerCompanyId_windowStart_key" ON "reorder_reminders"("organizationId", "buyerCompanyId", "windowStart");

-- AddForeignKey
ALTER TABLE "finance_settings" ADD CONSTRAINT "finance_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_installments" ADD CONSTRAINT "receivable_installments_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "receivables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_receipts" ADD CONSTRAINT "payment_receipts_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "receivables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "letters_of_credit" ADD CONSTRAINT "letters_of_credit_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "receivables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_reminders" ADD CONSTRAINT "receivable_reminders_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "receivables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_actual_costs" ADD CONSTRAINT "shipment_actual_costs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_profitability" ADD CONSTRAINT "shipment_profitability_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profitability_snapshots" ADD CONSTRAINT "profitability_snapshots_profitabilityId_fkey" FOREIGN KEY ("profitabilityId") REFERENCES "shipment_profitability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reorder_reminders" ADD CONSTRAINT "reorder_reminders_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

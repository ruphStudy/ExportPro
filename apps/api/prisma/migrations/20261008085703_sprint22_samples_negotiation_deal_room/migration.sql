-- CreateTable
CREATE TABLE "samples" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sampleNumber" TEXT NOT NULL,
    "iteration" INTEGER NOT NULL DEFAULT 1,
    "rootId" TEXT,
    "previousSampleId" TEXT,
    "source" TEXT NOT NULL,
    "buyerCompanyId" TEXT,
    "buyerName" TEXT,
    "inquiryId" TEXT,
    "sampleRequestId" TEXT,
    "crmLeadId" TEXT,
    "quotationId" TEXT,
    "buyerPurchaseOrderId" TEXT,
    "productId" TEXT,
    "productName" TEXT NOT NULL,
    "specification" TEXT,
    "quantity" DECIMAL(20,4),
    "unit" TEXT,
    "packaging" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedByUserId" TEXT NOT NULL,
    "requiredBy" TIMESTAMP(3),
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "ownerUserId" TEXT,
    "preparationDueAt" TIMESTAMP(3),
    "preparationStartedAt" TIMESTAMP(3),
    "preparedAt" TIMESTAMP(3),
    "packagingNotes" TEXT,
    "internalComments" TEXT,
    "courierProvider" TEXT,
    "bookingReference" TEXT,
    "trackingNumber" TEXT,
    "trackingUrl" TEXT,
    "shippedAt" TIMESTAMP(3),
    "expectedDeliveryAt" TIMESTAMP(3),
    "courierCost" DECIMAL(20,2),
    "courierCurrency" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "deliveryRecipient" TEXT,
    "deliverySource" TEXT,
    "deliveryNotes" TEXT,
    "decision" TEXT,
    "decisionReason" TEXT,
    "decisionNote" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sample_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sampleId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "source" TEXT,
    "note" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sample_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sample_costs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sampleId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(20,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "reportingCurrency" TEXT NOT NULL,
    "convertedAmount" DECIMAL(20,2),
    "fxRate" DECIMAL(20,10),
    "fxSourceLabel" TEXT,
    "incurredAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sample_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sample_feedback" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sampleId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "rating" INTEGER,
    "verdict" TEXT NOT NULL,
    "comments" TEXT,
    "qualityNotes" TEXT,
    "packagingNotes" TEXT,
    "priceFeedback" TEXT,
    "requestedChanges" TEXT,
    "idempotencyKey" TEXT,
    "recordedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sample_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sample_attachments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sampleId" TEXT NOT NULL,
    "feedbackId" TEXT,
    "category" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sample_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "negotiations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "negotiationNumber" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "buyerCompanyId" TEXT NOT NULL,
    "buyerName" TEXT,
    "inquiryId" TEXT,
    "quotationId" TEXT,
    "sampleId" TEXT,
    "crmLeadId" TEXT,
    "buyerPurchaseOrderId" TEXT,
    "costingId" TEXT,
    "costingScenarioId" TEXT,
    "productId" TEXT,
    "productName" TEXT,
    "targetMarginPercent" DECIMAL(9,4),
    "ownerUserId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "outcomeReason" TEXT,
    "outcomeNote" TEXT,
    "outcomeByUserId" TEXT,
    "outcomeAt" TIMESTAMP(3),
    "agreedRoundId" TEXT,
    "handoffQuotationId" TEXT,
    "approvalRequired" BOOLEAN NOT NULL DEFAULT false,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "negotiations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "negotiation_rounds" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "negotiationId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "side" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "notes" TEXT,
    "snapshot" JSONB NOT NULL,
    "idempotencyKey" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "negotiation_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_rooms" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "buyerCompanyId" TEXT,
    "buyerName" TEXT,
    "inquiryId" TEXT,
    "quotationId" TEXT,
    "proformaInvoiceId" TEXT,
    "buyerPurchaseOrderId" TEXT,
    "shipmentId" TEXT,
    "negotiationId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "tokenHint" TEXT NOT NULL,
    "tokenVersion" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "revokeReason" TEXT,
    "allowedEmail" TEXT,
    "accessCodeHash" TEXT,
    "allowComments" BOOLEAN NOT NULL DEFAULT false,
    "lastAccessAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deal_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_room_shares" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dealRoomId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "rootId" TEXT,
    "versionLabel" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT,
    "permission" TEXT NOT NULL DEFAULT 'VIEW',
    "sharedByUserId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "removedByUserId" TEXT,
    "replacedByShareId" TEXT,
    "replacesShareId" TEXT,

    CONSTRAINT "deal_room_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_room_access_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dealRoomId" TEXT NOT NULL,
    "shareId" TEXT,
    "event" TEXT NOT NULL,
    "tokenVersion" INTEGER NOT NULL,
    "sessionRef" TEXT,
    "guestEmail" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_room_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_room_comments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dealRoomId" TEXT NOT NULL,
    "shareId" TEXT,
    "guestName" TEXT NOT NULL,
    "guestEmail" TEXT,
    "body" TEXT NOT NULL,
    "hiddenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_room_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "samples_organizationId_status_idx" ON "samples"("organizationId", "status");

-- CreateIndex
CREATE INDEX "samples_organizationId_buyerCompanyId_idx" ON "samples"("organizationId", "buyerCompanyId");

-- CreateIndex
CREATE INDEX "samples_rootId_idx" ON "samples"("rootId");

-- CreateIndex
CREATE UNIQUE INDEX "samples_organizationId_sampleNumber_iteration_key" ON "samples"("organizationId", "sampleNumber", "iteration");

-- CreateIndex
CREATE INDEX "sample_events_sampleId_occurredAt_idx" ON "sample_events"("sampleId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "sample_events_sampleId_idempotencyKey_key" ON "sample_events"("sampleId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "sample_costs_sampleId_idx" ON "sample_costs"("sampleId");

-- CreateIndex
CREATE INDEX "sample_feedback_sampleId_idx" ON "sample_feedback"("sampleId");

-- CreateIndex
CREATE UNIQUE INDEX "sample_feedback_sampleId_idempotencyKey_key" ON "sample_feedback"("sampleId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "sample_attachments_sampleId_idx" ON "sample_attachments"("sampleId");

-- CreateIndex
CREATE INDEX "negotiations_organizationId_status_idx" ON "negotiations"("organizationId", "status");

-- CreateIndex
CREATE INDEX "negotiations_organizationId_buyerCompanyId_idx" ON "negotiations"("organizationId", "buyerCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "negotiations_organizationId_negotiationNumber_key" ON "negotiations"("organizationId", "negotiationNumber");

-- CreateIndex
CREATE UNIQUE INDEX "negotiation_rounds_negotiationId_sequence_key" ON "negotiation_rounds"("negotiationId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "negotiation_rounds_negotiationId_idempotencyKey_key" ON "negotiation_rounds"("negotiationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "deal_rooms_tokenHash_key" ON "deal_rooms"("tokenHash");

-- CreateIndex
CREATE INDEX "deal_rooms_organizationId_createdAt_idx" ON "deal_rooms"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "deal_room_shares_dealRoomId_idx" ON "deal_room_shares"("dealRoomId");

-- CreateIndex
CREATE INDEX "deal_room_access_logs_dealRoomId_at_idx" ON "deal_room_access_logs"("dealRoomId", "at");

-- CreateIndex
CREATE INDEX "deal_room_comments_dealRoomId_idx" ON "deal_room_comments"("dealRoomId");

-- AddForeignKey
ALTER TABLE "sample_events" ADD CONSTRAINT "sample_events_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "samples"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample_costs" ADD CONSTRAINT "sample_costs_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "samples"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample_feedback" ADD CONSTRAINT "sample_feedback_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "samples"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample_attachments" ADD CONSTRAINT "sample_attachments_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "samples"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "negotiation_rounds" ADD CONSTRAINT "negotiation_rounds_negotiationId_fkey" FOREIGN KEY ("negotiationId") REFERENCES "negotiations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_room_shares" ADD CONSTRAINT "deal_room_shares_dealRoomId_fkey" FOREIGN KEY ("dealRoomId") REFERENCES "deal_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_room_access_logs" ADD CONSTRAINT "deal_room_access_logs_dealRoomId_fkey" FOREIGN KEY ("dealRoomId") REFERENCES "deal_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_room_comments" ADD CONSTRAINT "deal_room_comments_dealRoomId_fkey" FOREIGN KEY ("dealRoomId") REFERENCES "deal_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

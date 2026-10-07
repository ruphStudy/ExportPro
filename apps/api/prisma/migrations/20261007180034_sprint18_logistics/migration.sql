-- CreateTable
CREATE TABLE "logistics_settings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "etaDelayWarningDays" INTEGER NOT NULL DEFAULT 2,
    "etaDelayCriticalDays" INTEGER NOT NULL DEFAULT 7,
    "autoDraftBuyerUpdates" BOOLEAN NOT NULL DEFAULT true,
    "buyerUpdateMode" TEXT NOT NULL DEFAULT 'REQUIRE_APPROVAL',
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "logistics_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_providers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "company" TEXT,
    "contactPerson" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "logistics_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "freight_requests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "transportMode" TEXT NOT NULL,
    "shipmentType" TEXT,
    "origin" TEXT,
    "destination" TEXT,
    "portOfLoading" TEXT,
    "portOfDischarge" TEXT,
    "incoterm" TEXT,
    "cargoDescription" TEXT,
    "packageCount" INTEGER,
    "grossWeightKg" DECIMAL(14,3),
    "netWeightKg" DECIMAL(14,3),
    "volumeCbm" DECIMAL(14,3),
    "readyDate" TIMESTAMPTZ(3),
    "preferredDeparture" TIMESTAMPTZ(3),
    "specialHandling" TEXT,
    "sources" JSONB NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "freight_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "freight_quotes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestId" TEXT,
    "purchaseOrderId" TEXT,
    "quotationId" TEXT,
    "providerId" TEXT,
    "forwarderName" TEXT NOT NULL,
    "shippingLine" TEXT,
    "carrier" TEXT,
    "serviceName" TEXT,
    "quoteReference" TEXT,
    "transportMode" TEXT NOT NULL,
    "shipmentType" TEXT,
    "containerSummary" TEXT,
    "origin" TEXT,
    "destination" TEXT,
    "portOfLoading" TEXT,
    "portOfDischarge" TEXT,
    "routeSummary" TEXT,
    "transshipmentPorts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "currency" TEXT NOT NULL,
    "totalCost" DECIMAL(20,2),
    "transitDays" INTEGER,
    "freeDays" INTEGER,
    "validityFrom" TIMESTAMPTZ(3),
    "validityUntil" TIMESTAMPTZ(3),
    "departureDate" TIMESTAMPTZ(3),
    "arrivalDate" TIMESTAMPTZ(3),
    "inclusions" TEXT,
    "exclusions" TEXT,
    "terms" TEXT,
    "riskNotes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "status" TEXT NOT NULL,
    "selectedByUserId" TEXT,
    "selectedAt" TIMESTAMPTZ(3),
    "selectionNote" TEXT,
    "overrideReason" TEXT,
    "rejectionReason" TEXT,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "freight_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "freight_quote_charges" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT,
    "amount" DECIMAL(20,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "freight_quote_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_attachments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "shipmentId" TEXT,
    "exceptionId" TEXT,
    "claimId" TEXT,
    "originalFilename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logistics_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shipmentNumber" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "freightQuoteId" TEXT,
    "proformaInvoiceId" TEXT,
    "quotationId" TEXT,
    "crmLeadId" TEXT,
    "buyerCompanyId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "shipmentType" TEXT,
    "incoterm" TEXT,
    "incotermPlace" TEXT,
    "originCountry" TEXT,
    "destinationCountry" TEXT,
    "portOfLoading" TEXT,
    "portOfDischarge" TEXT,
    "placeOfReceipt" TEXT,
    "placeOfDelivery" TEXT,
    "carrier" TEXT,
    "shippingLine" TEXT,
    "vesselName" TEXT,
    "voyageNumber" TEXT,
    "flightNumber" TEXT,
    "vehicleReference" TEXT,
    "bookingReference" TEXT,
    "blNumber" TEXT,
    "awbNumber" TEXT,
    "originalEtd" TIMESTAMPTZ(3),
    "etd" TIMESTAMPTZ(3),
    "etdUpdatedAt" TIMESTAMPTZ(3),
    "originalEta" TIMESTAMPTZ(3),
    "eta" TIMESTAMPTZ(3),
    "etaUpdatedAt" TIMESTAMPTZ(3),
    "actualDeparture" TIMESTAMPTZ(3),
    "actualArrival" TIMESTAMPTZ(3),
    "deliveredAt" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "holdFromStatus" TEXT,
    "health" TEXT NOT NULL DEFAULT 'ON_TRACK',
    "cargo" JSONB NOT NULL,
    "shippingBillNumber" TEXT,
    "shippingBillDate" TIMESTAMPTZ(3),
    "customsBroker" TEXT,
    "customsClearedAt" TIMESTAMPTZ(3),
    "complianceAcknowledged" BOOLEAN NOT NULL DEFAULT false,
    "complianceOverrideReason" TEXT,
    "quotedCost" DECIMAL(20,2),
    "quotedCurrency" TEXT,
    "actualFreight" DECIMAL(20,2),
    "actualSurcharges" DECIMAL(20,2),
    "actualLocalCharges" DECIMAL(20,2),
    "actualCostCurrency" TEXT,
    "actualCostNotes" TEXT,
    "trackingProvider" TEXT,
    "trackingLastFetchedAt" TIMESTAMPTZ(3),
    "trackingLastError" TEXT,
    "ownerUserId" TEXT,
    "notes" TEXT,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_milestones" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "plannedAt" TIMESTAMPTZ(3),
    "estimatedAt" TIMESTAMPTZ(3),
    "actualAt" TIMESTAMPTZ(3),
    "location" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "notes" TEXT,
    "reason" TEXT,
    "completedByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shipment_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_legs" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "mode" TEXT NOT NULL,
    "origin" TEXT,
    "destination" TEXT,
    "carrier" TEXT,
    "vesselName" TEXT,
    "voyageNumber" TEXT,
    "flightNumber" TEXT,
    "plannedDeparture" TIMESTAMPTZ(3),
    "plannedArrival" TIMESTAMPTZ(3),
    "actualDeparture" TIMESTAMPTZ(3),
    "actualArrival" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shipment_legs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_containers" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "containerNumber" TEXT NOT NULL,
    "containerType" TEXT,
    "sealNumber" TEXT,
    "packageCount" INTEGER,
    "grossWeightKg" DECIMAL(14,3),
    "netWeightKg" DECIMAL(14,3),
    "checkDigitValid" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shipment_containers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_tracking_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventTime" TIMESTAMPTZ(3) NOT NULL,
    "estimated" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT,
    "containerNumber" TEXT,
    "vesselName" TEXT,
    "voyageNumber" TEXT,
    "flightNumber" TEXT,
    "source" TEXT NOT NULL,
    "sourceReference" TEXT,
    "rawReference" TEXT,
    "description" TEXT NOT NULL,
    "previousValue" TEXT,
    "newValue" TEXT,
    "applied" BOOLEAN NOT NULL DEFAULT true,
    "appliedNote" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_tracking_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_exceptions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "autoKey" TEXT,
    "detectedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurredAt" TIMESTAMPTZ(3),
    "title" TEXT NOT NULL,
    "description" TEXT,
    "impact" TEXT,
    "location" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "trackingEventId" TEXT,
    "ownerUserId" TEXT,
    "dueAt" TIMESTAMPTZ(3),
    "resolution" TEXT,
    "resolvedAt" TIMESTAMPTZ(3),
    "resolvedByUserId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shipment_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_claims" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "exceptionId" TEXT,
    "description" TEXT NOT NULL,
    "quantityAffected" TEXT,
    "estimatedLoss" DECIMAL(20,2),
    "currency" TEXT,
    "claimReference" TEXT,
    "insurerReference" TEXT,
    "carrierReference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REPORTED',
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shipment_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_buyer_updates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "trackingEventId" TEXT,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "channel" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMPTZ(3),
    "recordedSentByUserId" TEXT,
    "recordedSentAt" TIMESTAMPTZ(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shipment_buyer_updates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "logistics_settings_organizationId_key" ON "logistics_settings"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "logistics_providers_organizationId_nameKey_key" ON "logistics_providers"("organizationId", "nameKey");

-- CreateIndex
CREATE INDEX "freight_requests_organizationId_purchaseOrderId_idx" ON "freight_requests"("organizationId", "purchaseOrderId");

-- CreateIndex
CREATE INDEX "freight_quotes_organizationId_purchaseOrderId_idx" ON "freight_quotes"("organizationId", "purchaseOrderId");

-- CreateIndex
CREATE INDEX "freight_quotes_organizationId_status_idx" ON "freight_quotes"("organizationId", "status");

-- CreateIndex
CREATE INDEX "freight_quote_charges_quoteId_idx" ON "freight_quote_charges"("quoteId");

-- CreateIndex
CREATE INDEX "logistics_attachments_organizationId_entityType_entityId_idx" ON "logistics_attachments"("organizationId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "shipments_organizationId_status_idx" ON "shipments"("organizationId", "status");

-- CreateIndex
CREATE INDEX "shipments_organizationId_purchaseOrderId_idx" ON "shipments"("organizationId", "purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_organizationId_shipmentNumber_key" ON "shipments"("organizationId", "shipmentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_milestones_shipmentId_stage_key" ON "shipment_milestones"("shipmentId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_legs_shipmentId_sequence_key" ON "shipment_legs"("shipmentId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_containers_shipmentId_containerNumber_key" ON "shipment_containers"("shipmentId", "containerNumber");

-- CreateIndex
CREATE INDEX "shipment_tracking_events_shipmentId_eventTime_idx" ON "shipment_tracking_events"("shipmentId", "eventTime");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_tracking_events_shipmentId_eventKey_key" ON "shipment_tracking_events"("shipmentId", "eventKey");

-- CreateIndex
CREATE INDEX "shipment_exceptions_organizationId_status_idx" ON "shipment_exceptions"("organizationId", "status");

-- CreateIndex
CREATE INDEX "shipment_exceptions_shipmentId_idx" ON "shipment_exceptions"("shipmentId");

-- CreateIndex
CREATE INDEX "shipment_claims_shipmentId_idx" ON "shipment_claims"("shipmentId");

-- CreateIndex
CREATE INDEX "shipment_buyer_updates_shipmentId_idx" ON "shipment_buyer_updates"("shipmentId");

-- AddForeignKey
ALTER TABLE "logistics_settings" ADD CONSTRAINT "logistics_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_providers" ADD CONSTRAINT "logistics_providers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "freight_requests" ADD CONSTRAINT "freight_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "freight_quotes" ADD CONSTRAINT "freight_quotes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "freight_quotes" ADD CONSTRAINT "freight_quotes_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "freight_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "freight_quotes" ADD CONSTRAINT "freight_quotes_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "logistics_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "freight_quote_charges" ADD CONSTRAINT "freight_quote_charges_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "freight_quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_freightQuoteId_fkey" FOREIGN KEY ("freightQuoteId") REFERENCES "freight_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_milestones" ADD CONSTRAINT "shipment_milestones_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_legs" ADD CONSTRAINT "shipment_legs_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_containers" ADD CONSTRAINT "shipment_containers_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_tracking_events" ADD CONSTRAINT "shipment_tracking_events_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_exceptions" ADD CONSTRAINT "shipment_exceptions_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_claims" ADD CONSTRAINT "shipment_claims_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_claims" ADD CONSTRAINT "shipment_claims_exceptionId_fkey" FOREIGN KEY ("exceptionId") REFERENCES "shipment_exceptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_buyer_updates" ADD CONSTRAINT "shipment_buyer_updates_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

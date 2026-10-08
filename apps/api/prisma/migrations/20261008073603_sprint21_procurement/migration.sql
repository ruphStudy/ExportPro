-- AlterTable
ALTER TABLE "shipment_profitability" ADD COLUMN     "procurementSource" TEXT;

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT,
    "normalizedName" TEXT NOT NULL,
    "supplierType" TEXT,
    "state" TEXT,
    "city" TEXT,
    "address" TEXT,
    "contactPerson" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "phoneKey" TEXT,
    "website" TEXT,
    "gstin" TEXT,
    "pan" TEXT,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'USER_ADDED',
    "sourceLabel" TEXT,
    "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "lastCheckedAt" TIMESTAMPTZ(3),
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_products" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "productId" TEXT,
    "productName" TEXT NOT NULL,
    "hsCode" TEXT,
    "specification" TEXT,
    "moq" DECIMAL(20,4),
    "moqUnit" TEXT,
    "capacity" DECIMAL(20,4),
    "capacityUnit" TEXT,
    "capacityPeriod" TEXT,
    "indicativePrice" DECIMAL(20,4),
    "currency" TEXT,
    "priceUnit" TEXT,
    "leadTimeDays" INTEGER,
    "packaging" TEXT,
    "originState" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_certifications" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "number" TEXT,
    "issuingBody" TEXT,
    "issueDate" TIMESTAMPTZ(3),
    "expiryDate" TIMESTAMPTZ(3),
    "verification" TEXT NOT NULL DEFAULT 'NOT_PROVIDED',
    "attachmentId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_certifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_attachments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_shortlists" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "productKey" TEXT NOT NULL DEFAULT '',
    "rfqId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_shortlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_rfqs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rfqNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "productId" TEXT,
    "productName" TEXT NOT NULL,
    "specification" TEXT,
    "baseQuantity" DECIMAL(20,4),
    "wastagePercent" DECIMAL(8,4),
    "quantity" DECIMAL(20,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "requiredBy" TIMESTAMPTZ(3),
    "quoteDueDate" TIMESTAMPTZ(3),
    "deliveryLocation" TEXT,
    "packaging" TEXT,
    "qualityRequirements" TEXT,
    "certificationsRequired" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "paymentTermsRequested" TEXT,
    "validUntil" TIMESTAMPTZ(3),
    "notes" TEXT,
    "buyerPurchaseOrderId" TEXT,
    "shipmentId" TEXT,
    "opportunityId" TEXT,
    "selectedSupplierId" TEXT,
    "selectedQuoteId" TEXT,
    "selectedByUserId" TEXT,
    "selectedAt" TIMESTAMPTZ(3),
    "selectionReason" TEXT,
    "closedReason" TEXT,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_rfqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_rfq_recipients" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INVITED',
    "requestedAt" TIMESTAMPTZ(3),
    "requestedVia" TEXT,
    "recordedByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_rfq_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_quotes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "quoteReference" TEXT,
    "referenceKey" TEXT NOT NULL,
    "quoteDate" TIMESTAMPTZ(3),
    "validUntil" TIMESTAMPTZ(3),
    "quantity" DECIMAL(20,4),
    "unit" TEXT NOT NULL,
    "unitPrice" DECIMAL(20,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "priceBasis" TEXT NOT NULL DEFAULT 'EX_FACTORY',
    "moq" DECIMAL(20,4),
    "moqUnit" TEXT,
    "leadTimeDays" INTEGER,
    "capacity" DECIMAL(20,4),
    "capacityUnit" TEXT,
    "capacityPeriod" TEXT,
    "deliveryTerms" TEXT,
    "paymentTerms" TEXT,
    "packaging" TEXT,
    "taxPercent" DECIMAL(8,4),
    "taxIncluded" BOOLEAN,
    "packagingPerUnit" DECIMAL(20,4),
    "inlandTransportPerUnit" DECIMAL(20,4),
    "inspectionTotal" DECIMAL(20,2),
    "otherTotal" DECIMAL(20,2),
    "certificationsOffered" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "specificationOffered" TEXT,
    "notes" TEXT,
    "review" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL DEFAULT 'RECORDED',
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_purchase_orders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "spoNumber" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "procurementStatus" TEXT NOT NULL DEFAULT 'NOT_ORDERED',
    "supplierId" TEXT NOT NULL,
    "rfqId" TEXT,
    "quoteId" TEXT,
    "buyerPurchaseOrderId" TEXT,
    "shipmentId" TEXT,
    "currency" TEXT NOT NULL,
    "poDate" TIMESTAMPTZ(3),
    "packagingCost" DECIMAL(20,2),
    "inlandTransportCost" DECIMAL(20,2),
    "inspectionCost" DECIMAL(20,2),
    "otherCharges" DECIMAL(20,2),
    "taxAmount" DECIMAL(20,2),
    "subtotal" DECIMAL(20,2),
    "totalAmount" DECIMAL(20,2),
    "deliveryLocation" TEXT,
    "originalExpectedDate" TIMESTAMPTZ(3),
    "expectedDate" TIMESTAMPTZ(3),
    "actualReceivedAt" TIMESTAMPTZ(3),
    "paymentTerms" TEXT,
    "paymentSchedule" JSONB NOT NULL DEFAULT '[]',
    "qualityRequirements" TEXT,
    "certificationRequirements" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "issuedAt" TIMESTAMPTZ(3),
    "issuedByUserId" TEXT,
    "snapshot" JSONB,
    "revisions" JSONB NOT NULL DEFAULT '[]',
    "externallySentAt" TIMESTAMPTZ(3),
    "externallySentVia" TEXT,
    "externallySentByUserId" TEXT,
    "dispatchedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_purchase_order_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierPoId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "productId" TEXT,
    "productName" TEXT NOT NULL,
    "specification" TEXT,
    "quantity" DECIMAL(20,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "unitPrice" DECIMAL(20,4) NOT NULL,
    "taxPercent" DECIMAL(8,4),
    "receivedQuantity" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "damagedQuantity" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "acceptedQuantity" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "rejectedQuantity" DECIMAL(20,4) NOT NULL DEFAULT 0,

    CONSTRAINT "supplier_purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierPoId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "reason" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "procurement_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "grnNumber" TEXT NOT NULL,
    "supplierPoId" TEXT NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL,
    "location" TEXT,
    "receivedByUserId" TEXT NOT NULL,
    "notes" TEXT,
    "overReceiptReason" TEXT,
    "qualityStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "goodsReceiptId" TEXT NOT NULL,
    "supplierPoItemId" TEXT NOT NULL,
    "receivedQuantity" DECIMAL(20,4) NOT NULL,
    "damagedQuantity" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "acceptedQuantity" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "rejectedQuantity" DECIMAL(20,4) NOT NULL DEFAULT 0,

    CONSTRAINT "goods_receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_inspections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "goodsReceiptId" TEXT NOT NULL,
    "goodsReceiptItemId" TEXT,
    "inspectedAt" TIMESTAMPTZ(3) NOT NULL,
    "inspectorUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "checks" JSONB NOT NULL DEFAULT '[]',
    "acceptedQuantity" DECIMAL(20,4) NOT NULL,
    "rejectedQuantity" DECIMAL(20,4) NOT NULL,
    "reason" TEXT,
    "notes" TEXT,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "quality_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payables" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierPoId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "totalAmount" DECIMAL(20,2) NOT NULL,
    "paidAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "outstandingAmount" DECIMAL(20,2) NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'OPEN',
    "disputedAt" TIMESTAMPTZ(3),
    "disputeReason" TEXT,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_payables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payable_installments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "payableId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "percentage" DECIMAL(8,4),
    "amount" DECIMAL(20,2) NOT NULL,
    "trigger" TEXT NOT NULL,
    "dueDays" INTEGER,
    "fixedDate" TIMESTAMPTZ(3),
    "paidAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "outstandingAmount" DECIMAL(20,2) NOT NULL,

    CONSTRAINT "supplier_payable_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "payableId" TEXT NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "appliedAmount" DECIMAL(20,2) NOT NULL,
    "fxRate" DECIMAL(24,10),
    "paidAt" TIMESTAMPTZ(3) NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "referenceKey" TEXT,
    "bankName" TEXT,
    "notes" TEXT,
    "allocations" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECORDED',
    "reversalReason" TEXT,
    "reversedByUserId" TEXT,
    "reversedAt" TIMESTAMPTZ(3),
    "recordedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "suppliers_organizationId_normalizedName_idx" ON "suppliers"("organizationId", "normalizedName");

-- CreateIndex
CREATE INDEX "suppliers_organizationId_state_idx" ON "suppliers"("organizationId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_organizationId_gstin_key" ON "suppliers"("organizationId", "gstin");

-- CreateIndex
CREATE INDEX "supplier_products_organizationId_productName_idx" ON "supplier_products"("organizationId", "productName");

-- CreateIndex
CREATE INDEX "supplier_certifications_organizationId_type_idx" ON "supplier_certifications"("organizationId", "type");

-- CreateIndex
CREATE INDEX "supplier_attachments_organizationId_entityType_entityId_idx" ON "supplier_attachments"("organizationId", "entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_shortlists_organizationId_supplierId_productKey_key" ON "supplier_shortlists"("organizationId", "supplierId", "productKey");

-- CreateIndex
CREATE INDEX "supplier_rfqs_organizationId_status_idx" ON "supplier_rfqs"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_rfqs_organizationId_rfqNumber_key" ON "supplier_rfqs"("organizationId", "rfqNumber");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_rfq_recipients_rfqId_supplierId_key" ON "supplier_rfq_recipients"("rfqId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_quotes_rfqId_supplierId_referenceKey_key" ON "supplier_quotes"("rfqId", "supplierId", "referenceKey");

-- CreateIndex
CREATE INDEX "supplier_purchase_orders_organizationId_status_idx" ON "supplier_purchase_orders"("organizationId", "status");

-- CreateIndex
CREATE INDEX "supplier_purchase_orders_organizationId_buyerPurchaseOrderI_idx" ON "supplier_purchase_orders"("organizationId", "buyerPurchaseOrderId");

-- CreateIndex
CREATE INDEX "supplier_purchase_orders_organizationId_shipmentId_idx" ON "supplier_purchase_orders"("organizationId", "shipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_purchase_orders_organizationId_spoNumber_key" ON "supplier_purchase_orders"("organizationId", "spoNumber");

-- CreateIndex
CREATE INDEX "procurement_events_supplierPoId_createdAt_idx" ON "procurement_events"("supplierPoId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_organizationId_grnNumber_key" ON "goods_receipts"("organizationId", "grnNumber");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_organizationId_idempotencyKey_key" ON "goods_receipts"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payables_supplierPoId_key" ON "supplier_payables"("supplierPoId");

-- CreateIndex
CREATE INDEX "supplier_payables_organizationId_state_idx" ON "supplier_payables"("organizationId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payable_installments_payableId_sequence_key" ON "supplier_payable_installments"("payableId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payments_payableId_referenceKey_key" ON "supplier_payments"("payableId", "referenceKey");

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_products" ADD CONSTRAINT "supplier_products_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_certifications" ADD CONSTRAINT "supplier_certifications_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_rfqs" ADD CONSTRAINT "supplier_rfqs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_rfq_recipients" ADD CONSTRAINT "supplier_rfq_recipients_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "supplier_rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "supplier_rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_purchase_orders" ADD CONSTRAINT "supplier_purchase_orders_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_purchase_order_items" ADD CONSTRAINT "supplier_purchase_order_items_supplierPoId_fkey" FOREIGN KEY ("supplierPoId") REFERENCES "supplier_purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_events" ADD CONSTRAINT "procurement_events_supplierPoId_fkey" FOREIGN KEY ("supplierPoId") REFERENCES "supplier_purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_supplierPoId_fkey" FOREIGN KEY ("supplierPoId") REFERENCES "supplier_purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payables" ADD CONSTRAINT "supplier_payables_supplierPoId_fkey" FOREIGN KEY ("supplierPoId") REFERENCES "supplier_purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payable_installments" ADD CONSTRAINT "supplier_payable_installments_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "supplier_payables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "supplier_payables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

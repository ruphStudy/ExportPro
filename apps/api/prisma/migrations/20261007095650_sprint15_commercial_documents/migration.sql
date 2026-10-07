-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'READY', 'ISSUED', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'SUPERSEDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProformaInvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'SENT', 'ACCEPTED', 'SUPERSEDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('RECEIVED', 'UNDER_REVIEW', 'MATCHED', 'DISCREPANCY', 'ACCEPTED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "commercial_settings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "quotationPrefix" TEXT NOT NULL DEFAULT 'QT',
    "piPrefix" TEXT NOT NULL DEFAULT 'PI',
    "yearlyReset" BOOLEAN NOT NULL DEFAULT true,
    "unitPricePrecision" INTEGER NOT NULL DEFAULT 2,
    "defaultValidityDays" INTEGER NOT NULL DEFAULT 30,
    "quantityTolerancePercent" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "priceTolerancePercent" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "quotationTerms" TEXT,
    "piTerms" TEXT,
    "bankDetails" JSONB,
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commercial_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_number_sequences" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "commercial_number_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "quotationNumber" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "rootId" TEXT,
    "revisionOfId" TEXT,
    "revisionReason" TEXT,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "source" TEXT NOT NULL,
    "buyerCompanyId" TEXT,
    "buyerName" TEXT,
    "buyerContactId" TEXT,
    "crmLeadId" TEXT,
    "inquiryId" TEXT,
    "quotationRequestId" TEXT,
    "costingId" TEXT,
    "issueDate" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "currency" TEXT NOT NULL,
    "incoterm" TEXT,
    "incotermPlace" TEXT,
    "originCountry" TEXT,
    "destinationCountry" TEXT,
    "destinationPort" TEXT,
    "paymentTerms" TEXT,
    "deliveryTerms" TEXT,
    "leadTime" TEXT,
    "shipmentWindow" TEXT,
    "partialShipment" BOOLEAN,
    "transshipment" BOOLEAN,
    "buyerNotes" TEXT,
    "internalNotes" TEXT,
    "termsAndConditions" TEXT,
    "additionalCharges" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "chargesLabel" TEXT,
    "discount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(20,2),
    "totalAmount" DECIMAL(20,2),
    "buyerSnapshot" JSONB,
    "exporterSnapshot" JSONB,
    "issuedAt" TIMESTAMP(3),
    "issuedByUserId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "acceptedByUserId" TEXT,
    "acceptanceSource" TEXT,
    "buyerReference" TEXT,
    "acceptanceNote" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "expiredAt" TIMESTAMP(3),
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "productId" TEXT,
    "inquiryItemId" TEXT,
    "description" TEXT NOT NULL,
    "hsCode" TEXT,
    "specification" TEXT,
    "packaging" TEXT,
    "quantity" DECIMAL(20,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "unitPrice" DECIMAL(20,6),
    "totalPrice" DECIMAL(20,2),
    "deliveryNotes" TEXT,
    "countryOfOrigin" TEXT,
    "priceSource" TEXT NOT NULL DEFAULT 'MANUAL',
    "costingId" TEXT,
    "costingScenarioId" TEXT,
    "pricingSnapshot" JSONB,
    "costingUnitPrice" DECIMAL(20,6),
    "overrideReason" TEXT,
    "overriddenByUserId" TEXT,

    CONSTRAINT "quotation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proforma_invoices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "piNumber" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "rootId" TEXT,
    "revisionOfId" TEXT,
    "revisionReason" TEXT,
    "status" "ProformaInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "source" TEXT NOT NULL DEFAULT 'QUOTATION',
    "quotationId" TEXT,
    "overrideReason" TEXT,
    "buyerCompanyId" TEXT,
    "buyerName" TEXT,
    "crmLeadId" TEXT,
    "inquiryId" TEXT,
    "issueDate" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "currency" TEXT NOT NULL,
    "incoterm" TEXT,
    "incotermPlace" TEXT,
    "destinationCountry" TEXT,
    "destinationPort" TEXT,
    "paymentTerms" TEXT,
    "deliveryTerms" TEXT,
    "buyerNotes" TEXT,
    "internalNotes" TEXT,
    "terms" TEXT,
    "additionalCharges" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "chargesLabel" TEXT,
    "discount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "buyerSnapshot" JSONB,
    "exporterSnapshot" JSONB,
    "bankDetailsSnapshot" JSONB,
    "issuedAt" TIMESTAMP(3),
    "issuedByUserId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proforma_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proforma_invoice_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "piId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "quotationItemId" TEXT,
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "hsCode" TEXT,
    "specification" TEXT,
    "packaging" TEXT,
    "quantity" DECIMAL(20,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "unitPrice" DECIMAL(20,6) NOT NULL,
    "totalPrice" DECIMAL(20,2) NOT NULL,

    CONSTRAINT "proforma_invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_purchase_orders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "buyerCompanyId" TEXT NOT NULL,
    "crmLeadId" TEXT,
    "inquiryId" TEXT,
    "quotationId" TEXT,
    "proformaInvoiceId" TEXT,
    "poNumber" TEXT NOT NULL,
    "poNumberKey" TEXT NOT NULL,
    "poDate" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL,
    "incoterm" TEXT,
    "incotermPlace" TEXT,
    "paymentTerms" TEXT,
    "deliveryTerms" TEXT,
    "destination" TEXT,
    "totalAmount" DECIMAL(20,2),
    "notes" TEXT,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'RECEIVED',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "reviewDecision" TEXT,
    "reviewReason" TEXT,
    "overrideReason" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyer_purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_purchase_order_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "quotationItemId" TEXT,
    "productId" TEXT,
    "buyerProductCode" TEXT,
    "description" TEXT NOT NULL,
    "specification" TEXT,
    "packaging" TEXT,
    "quantity" DECIMAL(20,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "unitPrice" DECIMAL(20,6) NOT NULL,
    "totalPrice" DECIMAL(20,2),
    "deliveryDate" TEXT,

    CONSTRAINT "buyer_purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_attachments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "po_discrepancies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "against" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "itemLabel" TEXT,
    "expectedValue" TEXT,
    "actualValue" TEXT,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolutionNote" TEXT,
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "po_discrepancies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commercial_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "lineageId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "metadata" JSONB,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commercial_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "commercial_settings_organizationId_key" ON "commercial_settings"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "commercial_number_sequences_organizationId_docType_year_key" ON "commercial_number_sequences"("organizationId", "docType", "year");

-- CreateIndex
CREATE INDEX "quotations_organizationId_status_idx" ON "quotations"("organizationId", "status");

-- CreateIndex
CREATE INDEX "quotations_organizationId_updatedAt_idx" ON "quotations"("organizationId", "updatedAt");

-- CreateIndex
CREATE INDEX "quotations_rootId_idx" ON "quotations"("rootId");

-- CreateIndex
CREATE INDEX "quotations_buyerCompanyId_idx" ON "quotations"("buyerCompanyId");

-- CreateIndex
CREATE INDEX "quotations_crmLeadId_idx" ON "quotations"("crmLeadId");

-- CreateIndex
CREATE INDEX "quotations_inquiryId_idx" ON "quotations"("inquiryId");

-- CreateIndex
CREATE INDEX "quotations_costingId_idx" ON "quotations"("costingId");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_organizationId_quotationNumber_revision_key" ON "quotations"("organizationId", "quotationNumber", "revision");

-- CreateIndex
CREATE INDEX "quotation_items_quotationId_idx" ON "quotation_items"("quotationId");

-- CreateIndex
CREATE INDEX "quotation_items_costingId_idx" ON "quotation_items"("costingId");

-- CreateIndex
CREATE INDEX "proforma_invoices_organizationId_status_idx" ON "proforma_invoices"("organizationId", "status");

-- CreateIndex
CREATE INDEX "proforma_invoices_rootId_idx" ON "proforma_invoices"("rootId");

-- CreateIndex
CREATE INDEX "proforma_invoices_quotationId_idx" ON "proforma_invoices"("quotationId");

-- CreateIndex
CREATE INDEX "proforma_invoices_buyerCompanyId_idx" ON "proforma_invoices"("buyerCompanyId");

-- CreateIndex
CREATE INDEX "proforma_invoices_crmLeadId_idx" ON "proforma_invoices"("crmLeadId");

-- CreateIndex
CREATE UNIQUE INDEX "proforma_invoices_organizationId_piNumber_revision_key" ON "proforma_invoices"("organizationId", "piNumber", "revision");

-- CreateIndex
CREATE INDEX "proforma_invoice_items_piId_idx" ON "proforma_invoice_items"("piId");

-- CreateIndex
CREATE INDEX "buyer_purchase_orders_organizationId_status_idx" ON "buyer_purchase_orders"("organizationId", "status");

-- CreateIndex
CREATE INDEX "buyer_purchase_orders_quotationId_idx" ON "buyer_purchase_orders"("quotationId");

-- CreateIndex
CREATE INDEX "buyer_purchase_orders_proformaInvoiceId_idx" ON "buyer_purchase_orders"("proformaInvoiceId");

-- CreateIndex
CREATE INDEX "buyer_purchase_orders_crmLeadId_idx" ON "buyer_purchase_orders"("crmLeadId");

-- CreateIndex
CREATE UNIQUE INDEX "buyer_purchase_orders_organizationId_buyerCompanyId_poNumbe_key" ON "buyer_purchase_orders"("organizationId", "buyerCompanyId", "poNumberKey");

-- CreateIndex
CREATE INDEX "buyer_purchase_order_items_purchaseOrderId_idx" ON "buyer_purchase_order_items"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "purchase_order_attachments_purchaseOrderId_idx" ON "purchase_order_attachments"("purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "po_discrepancies_purchaseOrderId_signature_key" ON "po_discrepancies"("purchaseOrderId", "signature");

-- CreateIndex
CREATE INDEX "commercial_events_organizationId_lineageId_idx" ON "commercial_events"("organizationId", "lineageId");

-- AddForeignKey
ALTER TABLE "commercial_settings" ADD CONSTRAINT "commercial_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proforma_invoices" ADD CONSTRAINT "proforma_invoices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proforma_invoices" ADD CONSTRAINT "proforma_invoices_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proforma_invoice_items" ADD CONSTRAINT "proforma_invoice_items_piId_fkey" FOREIGN KEY ("piId") REFERENCES "proforma_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_purchase_orders" ADD CONSTRAINT "buyer_purchase_orders_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_purchase_orders" ADD CONSTRAINT "buyer_purchase_orders_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_purchase_orders" ADD CONSTRAINT "buyer_purchase_orders_proformaInvoiceId_fkey" FOREIGN KEY ("proformaInvoiceId") REFERENCES "proforma_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_purchase_order_items" ADD CONSTRAINT "buyer_purchase_order_items_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "buyer_purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_attachments" ADD CONSTRAINT "purchase_order_attachments_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "buyer_purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_discrepancies" ADD CONSTRAINT "po_discrepancies_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "buyer_purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

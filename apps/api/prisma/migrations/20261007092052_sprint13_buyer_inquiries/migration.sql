-- CreateEnum
CREATE TYPE "InquirySource" AS ENUM ('EMAIL_REPLY', 'MANUAL', 'RFQ_UPLOAD', 'CRM', 'OTHER');

-- CreateEnum
CREATE TYPE "InquiryStatus" AS ENUM ('NEW', 'REVIEWING', 'NEEDS_CLARIFICATION', 'QUALIFIED', 'REJECTED', 'ARCHIVED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "InquiryPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "InquiryExtractionStatus" AS ENUM ('NOT_STARTED', 'PROCESSING', 'COMPLETED', 'NEEDS_REVIEW', 'FAILED');

-- CreateEnum
CREATE TYPE "InquiryApprovalStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "InquiryRejectCategory" AS ENUM ('NOT_RELEVANT', 'PRODUCT_UNAVAILABLE', 'COMMERCIAL_MISMATCH', 'BUYER_RISK', 'INCOMPLETE_REQUIREMENT', 'OTHER');

-- CreateTable
CREATE TABLE "buyer_inquiries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "source" "InquirySource" NOT NULL,
    "sourceKey" TEXT,
    "sourceMessageId" TEXT,
    "buyerCompanyId" TEXT,
    "buyerName" TEXT,
    "buyerContactId" TEXT,
    "contactEmail" TEXT,
    "contactName" TEXT,
    "crmLeadId" TEXT,
    "productId" TEXT,
    "countryCode" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "rawBody" TEXT,
    "bodyWasHtml" BOOLEAN NOT NULL DEFAULT false,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "priority" "InquiryPriority" NOT NULL DEFAULT 'MEDIUM',
    "suggestedPriority" "InquiryPriority",
    "priorityReasons" TEXT[],
    "status" "InquiryStatus" NOT NULL DEFAULT 'NEW',
    "previousStatus" "InquiryStatus",
    "unread" BOOLEAN NOT NULL DEFAULT true,
    "assignedToUserId" TEXT,
    "extractionStatus" "InquiryExtractionStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "isRfq" BOOLEAN NOT NULL DEFAULT false,
    "approvalStatus" "InquiryApprovalStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "qualification" JSONB,
    "clarification" JSONB,
    "confirmedRfq" JSONB,
    "confirmedAt" TIMESTAMP(3),
    "confirmedByUserId" TEXT,
    "confirmedFromVersion" INTEGER,
    "rejectCategory" "InquiryRejectCategory",
    "rejectReason" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedByUserId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "rowVersion" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyer_inquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inquiry_attachments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "inquiryId" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "extractedText" TEXT,
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "inquiry_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inquiry_extractions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "inquiryId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "promptVersion" TEXT NOT NULL,
    "provenance" TEXT NOT NULL,
    "overallConfidence" INTEGER,
    "data" JSONB,
    "invalidFields" TEXT[],
    "error" TEXT,
    "attachmentsUsed" TEXT[],
    "attachmentsSkipped" JSONB,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inquiry_extractions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inquiry_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "inquiryId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "productName" TEXT NOT NULL,
    "productId" TEXT,
    "hsCode" TEXT,
    "quantity" DECIMAL(20,4),
    "quantityUnit" TEXT,
    "quantityText" TEXT,
    "specification" TEXT,
    "packaging" TEXT,
    "targetPrice" DECIMAL(20,6),
    "priceCurrency" TEXT,
    "priceUnitBasis" TEXT,
    "priceIndicative" BOOLEAN NOT NULL DEFAULT false,
    "deliveryDate" TEXT,

    CONSTRAINT "inquiry_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inquiry_activities" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "inquiryId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "metadata" JSONB,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inquiry_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inquiry_approvals" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "inquiryId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "actorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inquiry_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_requests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "inquiryId" TEXT NOT NULL,
    "crmLeadId" TEXT,
    "buyerCompanyId" TEXT,
    "items" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sample_requests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "inquiryId" TEXT NOT NULL,
    "buyerCompanyId" TEXT,
    "productName" TEXT,
    "productId" TEXT,
    "quantity" TEXT,
    "specification" TEXT,
    "deadline" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sample_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "buyer_inquiries_organizationId_status_receivedAt_idx" ON "buyer_inquiries"("organizationId", "status", "receivedAt");

-- CreateIndex
CREATE INDEX "buyer_inquiries_organizationId_unread_idx" ON "buyer_inquiries"("organizationId", "unread");

-- CreateIndex
CREATE INDEX "buyer_inquiries_organizationId_assignedToUserId_idx" ON "buyer_inquiries"("organizationId", "assignedToUserId");

-- CreateIndex
CREATE INDEX "buyer_inquiries_organizationId_priority_idx" ON "buyer_inquiries"("organizationId", "priority");

-- CreateIndex
CREATE INDEX "buyer_inquiries_organizationId_source_idx" ON "buyer_inquiries"("organizationId", "source");

-- CreateIndex
CREATE INDEX "buyer_inquiries_buyerCompanyId_idx" ON "buyer_inquiries"("buyerCompanyId");

-- CreateIndex
CREATE INDEX "buyer_inquiries_crmLeadId_idx" ON "buyer_inquiries"("crmLeadId");

-- CreateIndex
CREATE UNIQUE INDEX "buyer_inquiries_organizationId_reference_key" ON "buyer_inquiries"("organizationId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "buyer_inquiries_organizationId_sourceKey_key" ON "buyer_inquiries"("organizationId", "sourceKey");

-- CreateIndex
CREATE INDEX "inquiry_attachments_inquiryId_idx" ON "inquiry_attachments"("inquiryId");

-- CreateIndex
CREATE INDEX "inquiry_attachments_organizationId_checksum_idx" ON "inquiry_attachments"("organizationId", "checksum");

-- CreateIndex
CREATE UNIQUE INDEX "inquiry_extractions_inquiryId_version_key" ON "inquiry_extractions"("inquiryId", "version");

-- CreateIndex
CREATE INDEX "inquiry_items_inquiryId_idx" ON "inquiry_items"("inquiryId");

-- CreateIndex
CREATE INDEX "inquiry_items_organizationId_productId_idx" ON "inquiry_items"("organizationId", "productId");

-- CreateIndex
CREATE INDEX "inquiry_activities_inquiryId_createdAt_idx" ON "inquiry_activities"("inquiryId", "createdAt");

-- CreateIndex
CREATE INDEX "inquiry_approvals_inquiryId_idx" ON "inquiry_approvals"("inquiryId");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_requests_inquiryId_key" ON "quotation_requests"("inquiryId");

-- CreateIndex
CREATE INDEX "quotation_requests_organizationId_idx" ON "quotation_requests"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "sample_requests_inquiryId_key" ON "sample_requests"("inquiryId");

-- CreateIndex
CREATE INDEX "sample_requests_organizationId_idx" ON "sample_requests"("organizationId");

-- AddForeignKey
ALTER TABLE "buyer_inquiries" ADD CONSTRAINT "buyer_inquiries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_inquiries" ADD CONSTRAINT "buyer_inquiries_buyerCompanyId_fkey" FOREIGN KEY ("buyerCompanyId") REFERENCES "buyer_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_inquiries" ADD CONSTRAINT "buyer_inquiries_crmLeadId_fkey" FOREIGN KEY ("crmLeadId") REFERENCES "buyer_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_attachments" ADD CONSTRAINT "inquiry_attachments_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "buyer_inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_extractions" ADD CONSTRAINT "inquiry_extractions_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "buyer_inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_items" ADD CONSTRAINT "inquiry_items_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "buyer_inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_items" ADD CONSTRAINT "inquiry_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "organization_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_activities" ADD CONSTRAINT "inquiry_activities_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "buyer_inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_approvals" ADD CONSTRAINT "inquiry_approvals_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "buyer_inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_requests" ADD CONSTRAINT "quotation_requests_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "buyer_inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample_requests" ADD CONSTRAINT "sample_requests_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "buyer_inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

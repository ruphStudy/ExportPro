-- CreateEnum
CREATE TYPE "BuyerType" AS ENUM ('IMPORTER', 'DISTRIBUTOR', 'WHOLESALER', 'RETAILER', 'MANUFACTURER', 'AGENT', 'OTHER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CompanySize" AS ENUM ('MICRO', 'SMALL', 'MEDIUM', 'LARGE', 'ENTERPRISE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ImportFrequency" AS ENUM ('OCCASIONAL', 'REGULAR', 'FREQUENT', 'HIGH_FREQUENCY', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "BuyerSourceType" AS ENUM ('PUBLIC_TRADE_DATA', 'GOVERNMENT', 'PUBLIC_REGISTRY', 'BUSINESS_DIRECTORY', 'COMMERCIAL_PROVIDER', 'USER_PROVIDED', 'MANUAL_IMPORT', 'DEMO');

-- CreateEnum
CREATE TYPE "BuyerContactType" AS ENUM ('EMAIL', 'PHONE', 'WHATSAPP', 'WEBSITE_FORM', 'LINKEDIN_OR_SOCIAL_REFERENCE', 'OTHER');

-- CreateEnum
CREATE TYPE "ContactVerificationStatus" AS ENUM ('UNVERIFIED', 'SOURCE_LISTED', 'FORMAT_VALID', 'DOMAIN_MATCHED', 'VERIFIED', 'INVALID', 'STALE');

-- CreateEnum
CREATE TYPE "BuyerVerificationStatus" AS ENUM ('UNVERIFIED', 'PARTIALLY_VERIFIED', 'VERIFIED_SOURCE', 'MULTI_SOURCE_VERIFIED', 'NEEDS_REVIEW', 'SUSPICIOUS');

-- CreateEnum
CREATE TYPE "BuyerActivityType" AS ENUM ('TRADE_ACTIVITY', 'BUSINESS_LISTING');

-- CreateTable
CREATE TABLE "buyer_companies" (
    "id" TEXT NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "stateRegion" TEXT,
    "city" TEXT,
    "address" TEXT,
    "website" TEXT,
    "websiteDomain" TEXT,
    "buyerType" "BuyerType" NOT NULL DEFAULT 'UNKNOWN',
    "businessCategory" TEXT,
    "companySize" "CompanySize" NOT NULL DEFAULT 'UNKNOWN',
    "employeeRange" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "ownerOrganizationId" TEXT,
    "createdByUserId" TEXT,
    "verificationStatus" "BuyerVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "riskScore" INTEGER NOT NULL DEFAULT 50,
    "importFrequency" "ImportFrequency" NOT NULL DEFAULT 'UNKNOWN',
    "lastActivityDate" TIMESTAMP(3),
    "hasContact" BOOLEAN NOT NULL DEFAULT false,
    "hasVerifiedContact" BOOLEAN NOT NULL DEFAULT false,
    "maxContactConfidence" INTEGER,
    "lastVerifiedAt" TIMESTAMP(3),
    "profile" JSONB,
    "enrichedAt" TIMESTAMP(3),
    "enrichmentVersion" TEXT,
    "enrichmentExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyer_companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_source_records" (
    "id" TEXT NOT NULL,
    "buyerCompanyId" TEXT NOT NULL,
    "sourceId" TEXT,
    "sourceType" "BuyerSourceType" NOT NULL,
    "externalId" TEXT,
    "rawName" TEXT NOT NULL,
    "rawCountry" TEXT,
    "rawBuyerType" TEXT,
    "sourceUrl" TEXT,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceUpdatedAt" TIMESTAMP(3),
    "rawData" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "duplicateMatch" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyer_source_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_product_activities" (
    "id" TEXT NOT NULL,
    "buyerCompanyId" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "activityType" "BuyerActivityType" NOT NULL,
    "hsCode" TEXT,
    "productName" TEXT NOT NULL,
    "importFrequency" "ImportFrequency" NOT NULL DEFAULT 'UNKNOWN',
    "rawFrequency" TEXT,
    "transactionCount" INTEGER,
    "importValueUsd" DECIMAL(18,2),
    "importQuantity" DECIMAL(18,3),
    "quantityUnit" TEXT,
    "originCountries" TEXT[],
    "periodLabel" TEXT,
    "firstActivityDate" TIMESTAMP(3),
    "lastActivityDate" TIMESTAMP(3),
    "confidence" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buyer_product_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_contacts" (
    "id" TEXT NOT NULL,
    "buyerCompanyId" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT,
    "contactType" "BuyerContactType" NOT NULL,
    "value" TEXT NOT NULL,
    "verificationMethod" TEXT,
    "verificationStatus" "ContactVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "verifiedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyer_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_duplicate_candidates" (
    "id" TEXT NOT NULL,
    "buyerAId" TEXT NOT NULL,
    "buyerBId" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buyer_duplicate_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_buyers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "buyerCompanyId" TEXT NOT NULL,
    "shortlisted" BOOLEAN NOT NULL DEFAULT false,
    "savedAt" TIMESTAMP(3),
    "savedByUserId" TEXT,
    "productId" TEXT,
    "contextCountryCode" TEXT,
    "notes" TEXT,
    "notesUpdatedAt" TIMESTAMP(3),
    "notesUpdatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_buyers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_leads" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "buyerCompanyId" TEXT NOT NULL,
    "productId" TEXT,
    "contextKey" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'BUYER_DISCOVERY',
    "context" JSONB,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buyer_leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "buyer_companies_countryCode_buyerType_idx" ON "buyer_companies"("countryCode", "buyerType");

-- CreateIndex
CREATE INDEX "buyer_companies_normalizedName_countryCode_idx" ON "buyer_companies"("normalizedName", "countryCode");

-- CreateIndex
CREATE INDEX "buyer_companies_websiteDomain_countryCode_idx" ON "buyer_companies"("websiteDomain", "countryCode");

-- CreateIndex
CREATE INDEX "buyer_companies_verificationStatus_idx" ON "buyer_companies"("verificationStatus");

-- CreateIndex
CREATE INDEX "buyer_companies_riskScore_idx" ON "buyer_companies"("riskScore");

-- CreateIndex
CREATE INDEX "buyer_companies_ownerOrganizationId_idx" ON "buyer_companies"("ownerOrganizationId");

-- CreateIndex
CREATE INDEX "buyer_source_records_buyerCompanyId_idx" ON "buyer_source_records"("buyerCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "buyer_source_records_sourceId_externalId_key" ON "buyer_source_records"("sourceId", "externalId");

-- CreateIndex
CREATE INDEX "buyer_product_activities_hsCode_idx" ON "buyer_product_activities"("hsCode");

-- CreateIndex
CREATE INDEX "buyer_product_activities_buyerCompanyId_idx" ON "buyer_product_activities"("buyerCompanyId");

-- CreateIndex
CREATE INDEX "buyer_contacts_buyerCompanyId_idx" ON "buyer_contacts"("buyerCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "buyer_duplicate_candidates_buyerAId_buyerBId_key" ON "buyer_duplicate_candidates"("buyerAId", "buyerBId");

-- CreateIndex
CREATE INDEX "organization_buyers_organizationId_shortlisted_idx" ON "organization_buyers"("organizationId", "shortlisted");

-- CreateIndex
CREATE UNIQUE INDEX "organization_buyers_organizationId_buyerCompanyId_key" ON "organization_buyers"("organizationId", "buyerCompanyId");

-- CreateIndex
CREATE INDEX "buyer_leads_organizationId_idx" ON "buyer_leads"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "buyer_leads_organizationId_buyerCompanyId_contextKey_key" ON "buyer_leads"("organizationId", "buyerCompanyId", "contextKey");

-- AddForeignKey
ALTER TABLE "buyer_companies" ADD CONSTRAINT "buyer_companies_ownerOrganizationId_fkey" FOREIGN KEY ("ownerOrganizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_source_records" ADD CONSTRAINT "buyer_source_records_buyerCompanyId_fkey" FOREIGN KEY ("buyerCompanyId") REFERENCES "buyer_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_source_records" ADD CONSTRAINT "buyer_source_records_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "trade_data_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_product_activities" ADD CONSTRAINT "buyer_product_activities_buyerCompanyId_fkey" FOREIGN KEY ("buyerCompanyId") REFERENCES "buyer_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_product_activities" ADD CONSTRAINT "buyer_product_activities_sourceRecordId_fkey" FOREIGN KEY ("sourceRecordId") REFERENCES "buyer_source_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_contacts" ADD CONSTRAINT "buyer_contacts_buyerCompanyId_fkey" FOREIGN KEY ("buyerCompanyId") REFERENCES "buyer_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_contacts" ADD CONSTRAINT "buyer_contacts_sourceRecordId_fkey" FOREIGN KEY ("sourceRecordId") REFERENCES "buyer_source_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_duplicate_candidates" ADD CONSTRAINT "buyer_duplicate_candidates_buyerAId_fkey" FOREIGN KEY ("buyerAId") REFERENCES "buyer_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_duplicate_candidates" ADD CONSTRAINT "buyer_duplicate_candidates_buyerBId_fkey" FOREIGN KEY ("buyerBId") REFERENCES "buyer_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_buyers" ADD CONSTRAINT "organization_buyers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_buyers" ADD CONSTRAINT "organization_buyers_buyerCompanyId_fkey" FOREIGN KEY ("buyerCompanyId") REFERENCES "buyer_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_buyers" ADD CONSTRAINT "organization_buyers_productId_fkey" FOREIGN KEY ("productId") REFERENCES "organization_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_leads" ADD CONSTRAINT "buyer_leads_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_leads" ADD CONSTRAINT "buyer_leads_buyerCompanyId_fkey" FOREIGN KEY ("buyerCompanyId") REFERENCES "buyer_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_leads" ADD CONSTRAINT "buyer_leads_productId_fkey" FOREIGN KEY ("productId") REFERENCES "organization_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

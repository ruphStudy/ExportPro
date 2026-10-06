-- CreateEnum
CREATE TYPE "ProductInputType" AS ENUM ('PRODUCT_NAME', 'HS_CODE', 'ITC_HS_CODE', 'DESCRIPTION');

-- CreateEnum
CREATE TYPE "CodeSystem" AS ENUM ('HS', 'ITC_HS_INDIA');

-- CreateEnum
CREATE TYPE "ProductClassificationStatus" AS ENUM ('AI_SUGGESTED', 'USER_SELECTED', 'USER_CONFIRMED', 'OFFICIALLY_VERIFIED');

-- CreateEnum
CREATE TYPE "ClassificationSource" AS ENUM ('AI_SUGGESTED', 'REFERENCE_LOOKUP', 'USER_SELECTED');

-- CreateEnum
CREATE TYPE "AmbiguityStatus" AS ENUM ('CLEAR', 'AMBIGUOUS', 'INSUFFICIENT_INFORMATION');

-- CreateEnum
CREATE TYPE "ProductAnalysisStatus" AS ENUM ('PENDING_REVIEW', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "AnalysisSourceType" AS ENUM ('AI_DERIVED', 'DEVELOPMENT_DEMO', 'REFERENCE_LOOKUP');

-- CreateEnum
CREATE TYPE "TariffReferenceSourceType" AS ENUM ('OFFICIAL', 'DEVELOPMENT_SAMPLE');

-- AlterTable
ALTER TABLE "product_interests" ADD COLUMN     "analyzedAt" TIMESTAMP(3),
ADD COLUMN     "productId" TEXT;

-- CreateTable
CREATE TABLE "tariff_codes" (
    "id" TEXT NOT NULL,
    "codeSystem" "CodeSystem" NOT NULL,
    "code" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "parentCode" TEXT,
    "sourceType" "TariffReferenceSourceType" NOT NULL DEFAULT 'DEVELOPMENT_SAMPLE',
    "sourceName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tariff_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_analyses" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "inputType" "ProductInputType" NOT NULL,
    "rawInput" TEXT NOT NULL,
    "inputKey" TEXT NOT NULL,
    "categoryHint" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "clarificationAnswers" JSONB NOT NULL DEFAULT '[]',
    "normalizedProductName" TEXT NOT NULL,
    "productSummary" TEXT NOT NULL,
    "suggestedCategoryCode" TEXT NOT NULL,
    "identification" JSONB NOT NULL DEFAULT '{}',
    "identificationConfidence" INTEGER,
    "ambiguityStatus" "AmbiguityStatus" NOT NULL,
    "ambiguityReason" TEXT,
    "clarifyingQuestions" JSONB NOT NULL DEFAULT '[]',
    "status" "ProductAnalysisStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "sourceType" "AnalysisSourceType" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "promptVersion" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "productInterestId" TEXT,
    "opportunityId" TEXT,
    "productId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_classification_candidates" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "codeSystem" "CodeSystem" NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "confidence" INTEGER,
    "rank" INTEGER NOT NULL,
    "reasoningSummary" TEXT,
    "source" "ClassificationSource" NOT NULL,
    "inReferenceData" BOOLEAN NOT NULL DEFAULT false,
    "referenceDescription" TEXT,
    "selectedByUser" BOOLEAN NOT NULL DEFAULT false,
    "confirmedForPlatformUse" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_classification_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_products" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "description" TEXT,
    "categoryCode" TEXT,
    "classificationCode" TEXT NOT NULL,
    "codeSystem" "CodeSystem" NOT NULL,
    "hsCode" TEXT NOT NULL,
    "itcHsCode" TEXT,
    "classificationDescription" TEXT NOT NULL,
    "classificationStatus" "ProductClassificationStatus" NOT NULL,
    "classificationSource" "ClassificationSource" NOT NULL,
    "classificationConfidence" INTEGER,
    "lowConfidenceAcknowledged" BOOLEAN NOT NULL DEFAULT false,
    "confirmedByUserId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "analysisId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tariff_codes_parentCode_idx" ON "tariff_codes"("parentCode");

-- CreateIndex
CREATE UNIQUE INDEX "tariff_codes_codeSystem_code_key" ON "tariff_codes"("codeSystem", "code");

-- CreateIndex
CREATE INDEX "product_analyses_organizationId_createdAt_idx" ON "product_analyses"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "product_analyses_organizationId_inputKey_idx" ON "product_analyses"("organizationId", "inputKey");

-- CreateIndex
CREATE INDEX "product_classification_candidates_analysisId_idx" ON "product_classification_candidates"("analysisId");

-- CreateIndex
CREATE INDEX "organization_products_organizationId_normalizedName_idx" ON "organization_products"("organizationId", "normalizedName");

-- CreateIndex
CREATE INDEX "organization_products_organizationId_classificationCode_idx" ON "organization_products"("organizationId", "classificationCode");

-- AddForeignKey
ALTER TABLE "product_interests" ADD CONSTRAINT "product_interests_productId_fkey" FOREIGN KEY ("productId") REFERENCES "organization_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_analyses" ADD CONSTRAINT "product_analyses_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_analyses" ADD CONSTRAINT "product_analyses_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_analyses" ADD CONSTRAINT "product_analyses_productInterestId_fkey" FOREIGN KEY ("productInterestId") REFERENCES "product_interests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_analyses" ADD CONSTRAINT "product_analyses_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_analyses" ADD CONSTRAINT "product_analyses_productId_fkey" FOREIGN KEY ("productId") REFERENCES "organization_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_classification_candidates" ADD CONSTRAINT "product_classification_candidates_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "product_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_products" ADD CONSTRAINT "organization_products_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_products" ADD CONSTRAINT "organization_products_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_products" ADD CONSTRAINT "organization_products_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "product_analyses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ExportExperience" AS ENUM ('NONE', 'LESS_THAN_1_YEAR', 'ONE_TO_THREE_YEARS', 'THREE_TO_FIVE_YEARS', 'FIVE_TO_TEN_YEARS', 'TEN_PLUS_YEARS');

-- CreateEnum
CREATE TYPE "RiskTolerance" AS ENUM ('CONSERVATIVE', 'BALANCED', 'AGGRESSIVE');

-- CreateEnum
CREATE TYPE "InvestmentRange" AS ENUM ('UNDER_1L', 'L1_5', 'L5_10', 'L10_25', 'L25_50', 'L50_1CR', 'ABOVE_1CR');

-- CreateEnum
CREATE TYPE "ShipmentPreference" AS ENUM ('SAMPLES_ONLY', 'COURIER_PARCEL', 'UNDER_100KG', 'KG_100_500', 'KG_500_1MT', 'MT_1_5', 'MT_5_20', 'CONTAINER_SCALE', 'FLEXIBLE');

-- CreateEnum
CREATE TYPE "LogisticsMode" AS ENUM ('SEA', 'AIR', 'COURIER', 'ROAD', 'FLEXIBLE');

-- CreateEnum
CREATE TYPE "ExportGoal" AS ENUM ('FIND_FIRST_PRODUCT', 'START_EXPORTING_EXISTING', 'FIND_BUYERS', 'EXPAND_COUNTRIES', 'INCREASE_REVENUE', 'IMPROVE_PROFITABILITY', 'REDUCE_RISK', 'AUTOMATE_OPERATIONS', 'BUILD_REPEAT_BUSINESS');

-- CreateEnum
CREATE TYPE "ProductInterestType" AS ENUM ('CURRENT', 'INTERESTED');

-- CreateEnum
CREATE TYPE "CountryRelation" AS ENUM ('CURRENT', 'INTERESTED');

-- CreateEnum
CREATE TYPE "RegistrationType" AS ENUM ('IEC', 'GST', 'FSSAI', 'APEDA');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('NOT_APPLICABLE', 'NOT_APPLIED', 'APPLIED_PENDING', 'AVAILABLE', 'NOT_SURE');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('NOT_PROVIDED', 'USER_DECLARED', 'FORMAT_VALID', 'DOCUMENT_UPLOADED', 'PENDING_REVIEW', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CertificationStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'PENDING');

-- CreateEnum
CREATE TYPE "OnboardingDocumentType" AS ENUM ('IEC', 'GST', 'FSSAI', 'APEDA', 'CERTIFICATE');

-- CreateTable
CREATE TABLE "exporter_profiles" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "exporterType" "BusinessType",
    "exportExperience" "ExportExperience",
    "riskTolerance" "RiskTolerance",
    "onboardingStatus" "OnboardingStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "currentStep" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "productCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preferredIndustries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "investmentRange" "InvestmentRange",
    "desiredMarginMin" INTEGER,
    "desiredMarginMax" INTEGER,
    "shipmentPreference" "ShipmentPreference",
    "preferredLogistics" "LogisticsMode"[] DEFAULT ARRAY[]::"LogisticsMode"[],
    "exportGoals" "ExportGoal"[] DEFAULT ARRAY[]::"ExportGoal"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exporter_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_interests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "interestType" "ProductInterestType" NOT NULL DEFAULT 'INTERESTED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_interests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "target_countries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "relation" "CountryRelation" NOT NULL DEFAULT 'INTERESTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "target_countries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registrations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "RegistrationType" NOT NULL,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'NOT_SURE',
    "number" TEXT,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'NOT_PROVIDED',
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "metadata" JSONB DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certifications" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "number" TEXT,
    "issuer" TEXT,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "status" "CertificationStatus" NOT NULL DEFAULT 'ACTIVE',
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'USER_DECLARED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "certifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_documents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentType" "OnboardingDocumentType" NOT NULL,
    "registrationId" TEXT,
    "certificationId" TEXT,
    "originalFilename" TEXT NOT NULL,
    "storageUrl" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exporter_profiles_organizationId_key" ON "exporter_profiles"("organizationId");

-- CreateIndex
CREATE INDEX "product_interests_organizationId_idx" ON "product_interests"("organizationId");

-- CreateIndex
CREATE INDEX "target_countries_organizationId_idx" ON "target_countries"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "target_countries_organizationId_countryCode_key" ON "target_countries"("organizationId", "countryCode");

-- CreateIndex
CREATE INDEX "registrations_organizationId_idx" ON "registrations"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "registrations_organizationId_type_key" ON "registrations"("organizationId", "type");

-- CreateIndex
CREATE INDEX "certifications_organizationId_idx" ON "certifications"("organizationId");

-- CreateIndex
CREATE INDEX "onboarding_documents_organizationId_idx" ON "onboarding_documents"("organizationId");

-- CreateIndex
CREATE INDEX "onboarding_documents_registrationId_idx" ON "onboarding_documents"("registrationId");

-- CreateIndex
CREATE INDEX "onboarding_documents_certificationId_idx" ON "onboarding_documents"("certificationId");

-- AddForeignKey
ALTER TABLE "exporter_profiles" ADD CONSTRAINT "exporter_profiles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_interests" ADD CONSTRAINT "product_interests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "target_countries" ADD CONSTRAINT "target_countries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_documents" ADD CONSTRAINT "onboarding_documents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_documents" ADD CONSTRAINT "onboarding_documents_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_documents" ADD CONSTRAINT "onboarding_documents_certificationId_fkey" FOREIGN KEY ("certificationId") REFERENCES "certifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

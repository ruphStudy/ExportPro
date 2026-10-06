-- CreateEnum
CREATE TYPE "OpportunitySourceType" AS ENUM ('DEMO', 'OFFICIAL', 'PUBLIC_DATA', 'PARTNER', 'INTERNAL', 'AI_DERIVED');

-- CreateEnum
CREATE TYPE "FreshnessStatus" AS ENUM ('FRESH', 'RECENT', 'STALE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CompetitionLevel" AS ENUM ('LOW', 'MODERATE', 'HIGH');

-- CreateEnum
CREATE TYPE "ComplianceDifficulty" AS ENUM ('EASY', 'MODERATE', 'COMPLEX');

-- CreateEnum
CREATE TYPE "SeasonalityLevel" AS ENUM ('LOW', 'MODERATE', 'HIGH');

-- CreateEnum
CREATE TYPE "OpportunitySort" AS ENUM ('BEST', 'GROWTH', 'LOW_COMPETITION', 'HIGH_MARGIN', 'CONFIDENCE', 'RECENT');

-- CreateTable
CREATE TABLE "opportunities" (
    "id" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "productCategoryCode" TEXT NOT NULL,
    "destinationCountryCode" TEXT NOT NULL,
    "tradeDirection" "TradeDirection" NOT NULL DEFAULT 'EXPORT',
    "overallScore" INTEGER NOT NULL,
    "demandScore" INTEGER NOT NULL,
    "indiaExportScore" INTEGER NOT NULL,
    "growthScore" INTEGER NOT NULL,
    "competitionScore" INTEGER NOT NULL,
    "complianceScore" INTEGER NOT NULL,
    "logisticsScore" INTEGER NOT NULL,
    "marginScore" INTEGER NOT NULL,
    "seasonalityScore" INTEGER NOT NULL,
    "marketDiversityScore" INTEGER NOT NULL,
    "confidenceScore" INTEGER NOT NULL,
    "competitionLevel" "CompetitionLevel" NOT NULL,
    "complianceDifficulty" "ComplianceDifficulty" NOT NULL,
    "seasonalityLevel" "SeasonalityLevel" NOT NULL,
    "investmentRange" "InvestmentRange" NOT NULL,
    "sourceType" "OpportunitySourceType" NOT NULL DEFAULT 'DEMO',
    "sourceName" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceDate" TIMESTAMP(3) NOT NULL,
    "freshnessStatus" "FreshnessStatus" NOT NULL,
    "metadata" JSONB DEFAULT '{}',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_score_snapshots" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "overallScore" INTEGER NOT NULL,
    "components" JSONB NOT NULL,
    "confidence" INTEGER NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opportunity_score_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_opportunities" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "savedByUserId" TEXT NOT NULL,
    "notes" TEXT,
    "alertEnabled" BOOLEAN NOT NULL DEFAULT false,
    "minimumScoreChange" INTEGER,
    "lastAlertedScore" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_opportunity_searches" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" JSONB NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_opportunity_searches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "opportunities_destinationCountryCode_idx" ON "opportunities"("destinationCountryCode");

-- CreateIndex
CREATE INDEX "opportunities_productCategoryCode_idx" ON "opportunities"("productCategoryCode");

-- CreateIndex
CREATE INDEX "opportunities_overallScore_idx" ON "opportunities"("overallScore");

-- CreateIndex
CREATE INDEX "opportunity_score_snapshots_opportunityId_capturedAt_idx" ON "opportunity_score_snapshots"("opportunityId", "capturedAt");

-- CreateIndex
CREATE INDEX "saved_opportunities_organizationId_idx" ON "saved_opportunities"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "saved_opportunities_organizationId_opportunityId_key" ON "saved_opportunities"("organizationId", "opportunityId");

-- CreateIndex
CREATE INDEX "saved_opportunity_searches_organizationId_idx" ON "saved_opportunity_searches"("organizationId");

-- AddForeignKey
ALTER TABLE "opportunity_score_snapshots" ADD CONSTRAINT "opportunity_score_snapshots_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_opportunities" ADD CONSTRAINT "saved_opportunities_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_opportunities" ADD CONSTRAINT "saved_opportunities_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_opportunities" ADD CONSTRAINT "saved_opportunities_savedByUserId_fkey" FOREIGN KEY ("savedByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_opportunity_searches" ADD CONSTRAINT "saved_opportunity_searches_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_opportunity_searches" ADD CONSTRAINT "saved_opportunity_searches_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

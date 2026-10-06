-- CreateEnum
CREATE TYPE "CrmStage" AS ENUM ('NEW', 'CONTACTED', 'REPLIED', 'INTERESTED', 'QUALIFIED', 'QUOTATION', 'NEGOTIATION', 'SAMPLE', 'PO', 'SHIPMENT', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "LeadPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "LostReason" AS ENUM ('PRICE', 'COMPETITOR', 'NO_RESPONSE', 'PRODUCT_FIT', 'PAYMENT_TERMS', 'DELIVERY', 'COMPLIANCE', 'BUYER_CANCELLED', 'OTHER');

-- CreateEnum
CREATE TYPE "LeadActivityType" AS ENUM ('NOTE', 'EMAIL', 'CALL', 'MEETING', 'STAGE_CHANGE', 'TASK', 'COMMENT', 'ATTACHMENT', 'SYSTEM', 'OTHER');

-- CreateEnum
CREATE TYPE "ActivityDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "LeadTaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LeadReminderType" AS ENUM ('FOLLOW_UP', 'TASK', 'NEXT_ACTION', 'CUSTOM');

-- CreateEnum
CREATE TYPE "LeadReminderStatus" AS ENUM ('PENDING', 'TRIGGERED', 'DISMISSED', 'CANCELLED');

-- AlterTable
ALTER TABLE "buyer_leads" ADD COLUMN     "currency" TEXT,
ADD COLUMN     "expectedValue" DECIMAL(18,2),
ADD COLUMN     "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "lostAt" TIMESTAMP(3),
ADD COLUMN     "lostDetails" TEXT,
ADD COLUMN     "lostReason" "LostReason",
ADD COLUMN     "nextAction" TEXT,
ADD COLUMN     "nextActionDueAt" TIMESTAMP(3),
ADD COLUMN     "ownerUserId" TEXT,
ADD COLUMN     "primaryContactId" TEXT,
ADD COLUMN     "priority" "LeadPriority" NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN     "qualification" JSONB,
ADD COLUMN     "stage" "CrmStage" NOT NULL DEFAULT 'NEW',
ADD COLUMN     "stageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "wonAt" TIMESTAMP(3),
ADD COLUMN     "wonReason" TEXT;

-- CreateTable
CREATE TABLE "lead_stage_history" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "fromStage" "CrmStage",
    "toStage" "CrmStage" NOT NULL,
    "changedByUserId" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "metadata" JSONB,

    CONSTRAINT "lead_stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_activities" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" "LeadActivityType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "direction" "ActivityDirection",
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contactId" TEXT,
    "outcome" TEXT,
    "durationMinutes" INTEGER,
    "location" TEXT,
    "metadata" JSONB,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_tasks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assignedToUserId" TEXT,
    "dueAt" TIMESTAMP(3),
    "priority" "LeadPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "LeadTaskStatus" NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_reminders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "taskId" TEXT,
    "userId" TEXT NOT NULL,
    "remindAt" TIMESTAMP(3) NOT NULL,
    "type" "LeadReminderType" NOT NULL DEFAULT 'FOLLOW_UP',
    "status" "LeadReminderStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT NOT NULL,
    "triggeredAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_comments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "authorUserId" TEXT,
    "body" TEXT NOT NULL,
    "mentionedUserIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),

    CONSTRAINT "lead_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_tags" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_tag_assignments" (
    "leadId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_tag_assignments_pkey" PRIMARY KEY ("leadId","tagId")
);

-- CreateTable
CREATE TABLE "lead_attachments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "lead_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_stage_history_leadId_changedAt_idx" ON "lead_stage_history"("leadId", "changedAt");

-- CreateIndex
CREATE INDEX "lead_stage_history_organizationId_toStage_changedAt_idx" ON "lead_stage_history"("organizationId", "toStage", "changedAt");

-- CreateIndex
CREATE INDEX "lead_activities_leadId_occurredAt_idx" ON "lead_activities"("leadId", "occurredAt");

-- CreateIndex
CREATE INDEX "lead_tasks_leadId_idx" ON "lead_tasks"("leadId");

-- CreateIndex
CREATE INDEX "lead_tasks_organizationId_status_dueAt_idx" ON "lead_tasks"("organizationId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "lead_tasks_organizationId_assignedToUserId_status_idx" ON "lead_tasks"("organizationId", "assignedToUserId", "status");

-- CreateIndex
CREATE INDEX "lead_reminders_leadId_idx" ON "lead_reminders"("leadId");

-- CreateIndex
CREATE INDEX "lead_reminders_organizationId_userId_status_remindAt_idx" ON "lead_reminders"("organizationId", "userId", "status", "remindAt");

-- CreateIndex
CREATE INDEX "lead_comments_leadId_createdAt_idx" ON "lead_comments"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "lead_comments_organizationId_idx" ON "lead_comments"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "lead_tags_organizationId_normalizedName_key" ON "lead_tags"("organizationId", "normalizedName");

-- CreateIndex
CREATE INDEX "lead_tag_assignments_tagId_idx" ON "lead_tag_assignments"("tagId");

-- CreateIndex
CREATE INDEX "lead_attachments_leadId_idx" ON "lead_attachments"("leadId");

-- CreateIndex
CREATE INDEX "buyer_leads_organizationId_stage_idx" ON "buyer_leads"("organizationId", "stage");

-- CreateIndex
CREATE INDEX "buyer_leads_organizationId_ownerUserId_idx" ON "buyer_leads"("organizationId", "ownerUserId");

-- CreateIndex
CREATE INDEX "buyer_leads_organizationId_nextActionDueAt_idx" ON "buyer_leads"("organizationId", "nextActionDueAt");

-- CreateIndex
CREATE INDEX "buyer_leads_organizationId_lastActivityAt_idx" ON "buyer_leads"("organizationId", "lastActivityAt");

-- CreateIndex
CREATE INDEX "buyer_leads_organizationId_updatedAt_idx" ON "buyer_leads"("organizationId", "updatedAt");

-- AddForeignKey
ALTER TABLE "buyer_leads" ADD CONSTRAINT "buyer_leads_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_stage_history" ADD CONSTRAINT "lead_stage_history_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "buyer_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "buyer_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_tasks" ADD CONSTRAINT "lead_tasks_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "buyer_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_tasks" ADD CONSTRAINT "lead_tasks_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_reminders" ADD CONSTRAINT "lead_reminders_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "buyer_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_reminders" ADD CONSTRAINT "lead_reminders_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "lead_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_comments" ADD CONSTRAINT "lead_comments_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "buyer_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_tag_assignments" ADD CONSTRAINT "lead_tag_assignments_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "buyer_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_tag_assignments" ADD CONSTRAINT "lead_tag_assignments_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "lead_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_attachments" ADD CONSTRAINT "lead_attachments_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "buyer_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: existing Sprint 10 handoff leads become NEW pipeline leads.
-- Stage defaults to NEW via the column default; clocks start at the
-- original handoff time; each gets an initial stage-history row and an
-- "Added to CRM" timeline entry. No lead rows are created or removed.
UPDATE "buyer_leads"
SET "lastActivityAt" = "createdAt",
    "stageChangedAt" = "createdAt",
    "updatedAt"      = "createdAt";

INSERT INTO "lead_stage_history" ("id", "organizationId", "leadId", "fromStage", "toStage", "changedByUserId", "changedAt", "reason")
SELECT 'mig11h' || md5("id"), "organizationId", "id", NULL, 'NEW', "createdByUserId", "createdAt", 'Added to CRM (Sprint 10 handoff)'
FROM "buyer_leads";

INSERT INTO "lead_activities" ("id", "organizationId", "leadId", "type", "title", "occurredAt", "actorUserId", "createdAt", "metadata")
SELECT 'mig11a' || md5("id"), "organizationId", "id", 'SYSTEM', 'Added to CRM', "createdAt", "createdByUserId", "createdAt", jsonb_build_object('source', "source")
FROM "buyer_leads";

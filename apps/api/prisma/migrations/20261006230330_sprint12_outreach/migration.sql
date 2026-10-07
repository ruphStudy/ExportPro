-- CreateEnum
CREATE TYPE "OutreachChannel" AS ENUM ('EMAIL', 'WHATSAPP', 'LINKEDIN_MANUAL', 'OTHER');

-- CreateEnum
CREATE TYPE "DeliveryMode" AS ENUM ('DEVELOPMENT', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "DomainStatus" AS ENUM ('NOT_CONFIGURED', 'PENDING', 'VERIFIED', 'FAILED', 'DEVELOPMENT_ONLY');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "OutreachMessageStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'QUEUED', 'SENT', 'DELIVERED', 'OPENED', 'REPLIED', 'BOUNCED', 'FAILED', 'CANCELLED', 'OPTED_OUT');

-- CreateEnum
CREATE TYPE "RecipientStatus" AS ENUM ('PENDING', 'ACTIVE', 'EXCLUDED', 'REPLIED', 'BOUNCED', 'OPTED_OUT', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "ExclusionReason" AS ENUM ('NO_CONTACT', 'INVALID_CONTACT', 'SUPPRESSED_UNSUBSCRIBED', 'SUPPRESSED_BOUNCE', 'SUPPRESSED_COMPLAINT', 'SUPPRESSED_MANUAL', 'DUPLICATE', 'DEMO_RECIPIENT', 'COOLDOWN', 'CAMPAIGN_LIMIT', 'UNRESOLVED_VARIABLE');

-- CreateEnum
CREATE TYPE "OutreachTemplateType" AS ENUM ('INTRODUCTION', 'CATALOG', 'QUOTATION_INTRODUCTION', 'SAMPLE_OFFER', 'FOLLOW_UP', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ContentSource" AS ENUM ('TEMPLATE', 'AI', 'AI_EDITED', 'MANUAL');

-- CreateEnum
CREATE TYPE "OutreachEventType" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'BOUNCED', 'REPLIED', 'COMPLAINT', 'UNSUBSCRIBED', 'FAILED');

-- CreateEnum
CREATE TYPE "OutreachEventSource" AS ENUM ('PROVIDER', 'MANUAL', 'SYSTEM', 'DEVELOPMENT');

-- CreateEnum
CREATE TYPE "SuppressionReason" AS ENUM ('UNSUBSCRIBED', 'COMPLAINT', 'MANUAL_BLOCK', 'HARD_BOUNCE');

-- CreateTable
CREATE TABLE "organization_outreach_settings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fromName" TEXT,
    "fromEmail" TEXT,
    "replyTo" TEXT,
    "companyName" TEXT,
    "companyWebsite" TEXT,
    "signature" TEXT,
    "dailyLimit" INTEGER NOT NULL DEFAULT 50,
    "maxRecipientsPerCampaign" INTEGER NOT NULL DEFAULT 25,
    "maxFollowUps" INTEGER NOT NULL DEFAULT 2,
    "contactCooldownDays" INTEGER NOT NULL DEFAULT 14,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "domainStatus" "DomainStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "domainCheckedAt" TIMESTAMP(3),
    "domainMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_outreach_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "name" TEXT NOT NULL,
    "type" "OutreachTemplateType" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "variables" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outreach_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_campaigns" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "productId" TEXT,
    "countryCode" TEXT,
    "channel" "OutreachChannel" NOT NULL DEFAULT 'EMAIL',
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "templateId" TEXT,
    "templateVersion" INTEGER,
    "subject" TEXT NOT NULL DEFAULT '',
    "messageBody" TEXT NOT NULL DEFAULT '',
    "language" TEXT NOT NULL DEFAULT 'en',
    "contentSource" "ContentSource" NOT NULL DEFAULT 'MANUAL',
    "generationProvider" TEXT,
    "generatedAt" TIMESTAMP(3),
    "sendMode" TEXT NOT NULL DEFAULT 'NOW',
    "scheduledAt" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "deliveryMode" "DeliveryMode",
    "provider" TEXT,
    "fromName" TEXT,
    "fromEmail" TEXT,
    "replyTo" TEXT,
    "signature" TEXT,
    "companyName" TEXT,
    "companyWebsite" TEXT,
    "audienceCount" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT NOT NULL,
    "launchedByUserId" TEXT,
    "launchedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outreach_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_campaign_steps" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "delayDays" INTEGER NOT NULL DEFAULT 0,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "outreach_campaign_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_campaign_recipients" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "buyerCompanyId" TEXT NOT NULL,
    "contactId" TEXT,
    "crmLeadId" TEXT,
    "address" TEXT,
    "contactName" TEXT,
    "personalization" JSONB,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "status" "RecipientStatus" NOT NULL DEFAULT 'PENDING',
    "excludedReason" "ExclusionReason",
    "warnings" TEXT[],
    "interested" BOOLEAN NOT NULL DEFAULT false,
    "interestedAt" TIMESTAMP(3),
    "unsubscribeToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outreach_campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_messages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT,
    "recipientId" TEXT,
    "buyerCompanyId" TEXT,
    "crmLeadId" TEXT,
    "channel" "OutreachChannel" NOT NULL DEFAULT 'EMAIL',
    "direction" TEXT NOT NULL DEFAULT 'OUTBOUND',
    "stepOrder" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "fromAddress" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "testSend" BOOLEAN NOT NULL DEFAULT false,
    "status" "OutreachMessageStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outreach_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_message_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "type" "OutreachEventType" NOT NULL,
    "source" "OutreachEventSource" NOT NULL,
    "provider" TEXT,
    "providerEventId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outreach_message_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_suppressions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "buyerCompanyId" TEXT,
    "reason" "SuppressionReason" NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outreach_suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_outreach_settings_organizationId_key" ON "organization_outreach_settings"("organizationId");

-- CreateIndex
CREATE INDEX "outreach_templates_organizationId_active_idx" ON "outreach_templates"("organizationId", "active");

-- CreateIndex
CREATE INDEX "outreach_campaigns_organizationId_status_idx" ON "outreach_campaigns"("organizationId", "status");

-- CreateIndex
CREATE INDEX "outreach_campaigns_organizationId_createdAt_idx" ON "outreach_campaigns"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "outreach_campaign_steps_campaignId_order_key" ON "outreach_campaign_steps"("campaignId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "outreach_campaign_recipients_unsubscribeToken_key" ON "outreach_campaign_recipients"("unsubscribeToken");

-- CreateIndex
CREATE INDEX "outreach_campaign_recipients_campaignId_status_idx" ON "outreach_campaign_recipients"("campaignId", "status");

-- CreateIndex
CREATE INDEX "outreach_campaign_recipients_organizationId_buyerCompanyId_idx" ON "outreach_campaign_recipients"("organizationId", "buyerCompanyId");

-- CreateIndex
CREATE INDEX "outreach_campaign_recipients_crmLeadId_idx" ON "outreach_campaign_recipients"("crmLeadId");

-- CreateIndex
CREATE UNIQUE INDEX "outreach_campaign_recipients_campaignId_buyerCompanyId_key" ON "outreach_campaign_recipients"("campaignId", "buyerCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "outreach_messages_idempotencyKey_key" ON "outreach_messages"("idempotencyKey");

-- CreateIndex
CREATE INDEX "outreach_messages_status_scheduledAt_idx" ON "outreach_messages"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "outreach_messages_organizationId_createdAt_idx" ON "outreach_messages"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "outreach_messages_organizationId_toAddress_idx" ON "outreach_messages"("organizationId", "toAddress");

-- CreateIndex
CREATE INDEX "outreach_messages_providerMessageId_idx" ON "outreach_messages"("providerMessageId");

-- CreateIndex
CREATE INDEX "outreach_messages_buyerCompanyId_idx" ON "outreach_messages"("buyerCompanyId");

-- CreateIndex
CREATE INDEX "outreach_messages_crmLeadId_idx" ON "outreach_messages"("crmLeadId");

-- CreateIndex
CREATE INDEX "outreach_message_events_messageId_idx" ON "outreach_message_events"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "outreach_message_events_provider_providerEventId_key" ON "outreach_message_events"("provider", "providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "outreach_suppressions_organizationId_address_key" ON "outreach_suppressions"("organizationId", "address");

-- AddForeignKey
ALTER TABLE "organization_outreach_settings" ADD CONSTRAINT "organization_outreach_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_templates" ADD CONSTRAINT "outreach_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_campaigns" ADD CONSTRAINT "outreach_campaigns_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_campaigns" ADD CONSTRAINT "outreach_campaigns_productId_fkey" FOREIGN KEY ("productId") REFERENCES "organization_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_campaign_steps" ADD CONSTRAINT "outreach_campaign_steps_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "outreach_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_campaign_recipients" ADD CONSTRAINT "outreach_campaign_recipients_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "outreach_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_campaign_recipients" ADD CONSTRAINT "outreach_campaign_recipients_buyerCompanyId_fkey" FOREIGN KEY ("buyerCompanyId") REFERENCES "buyer_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "outreach_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "outreach_campaign_recipients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_message_events" ADD CONSTRAINT "outreach_message_events_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "outreach_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_suppressions" ADD CONSTRAINT "outreach_suppressions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- System starter templates (organizationId NULL = read-only, duplicate to customize).
-- Content only uses controlled variables; no claims about certifications, prices or capacity.
INSERT INTO "outreach_templates" ("id","organizationId","name","type","subject","body","language","variables","active","version","createdAt","updatedAt") VALUES
('sys_tpl_intro', NULL, 'Introduction — product supplier', 'INTRODUCTION',
 '{{productName}} supply from India for {{buyerCompany}}',
 E'Dear {{contactName}},\n\nI am writing from {{companyName}}, an Indian exporter of {{productName}} (HS {{hsCode}}).\n\nWe are looking to work with importers in {{country}} and would like to understand whether {{productName}} is of interest to {{buyerCompany}}.\n\nIf useful, I can share product specifications and discuss your requirements.\n\nBest regards,\n{{senderName}}\n{{companyName}}\n{{website}}',
 'en', ARRAY['contactName','companyName','productName','hsCode','country','buyerCompany','senderName','website'], true, 1, now(), now()),
('sys_tpl_catalog', NULL, 'Catalog / product details', 'CATALOG',
 '{{productName}} — product details for {{buyerCompany}}',
 E'Dear {{contactName}},\n\n{{companyName}} supplies {{productName}} (HS {{hsCode}}) from India.\n\nWe would be glad to send our product catalogue and specifications so your team can assess fit for the {{country}} market. Please let me know the grades, packaging or quantities you typically source.\n\nKind regards,\n{{senderName}}\n{{companyName}}\n{{website}}',
 'en', ARRAY['contactName','companyName','productName','hsCode','buyerCompany','country','senderName','website'], true, 1, now(), now()),
('sys_tpl_quote', NULL, 'Quotation introduction', 'QUOTATION_INTRODUCTION',
 'Quotation for {{productName}} — {{companyName}}',
 E'Dear {{contactName}},\n\nIf {{buyerCompany}} is currently sourcing {{productName}}, we would be happy to prepare a quotation.\n\nTo quote accurately, could you share the specification, quantity, packaging, destination port in {{country}} and preferred Incoterms?\n\nBest regards,\n{{senderName}}\n{{companyName}}',
 'en', ARRAY['contactName','buyerCompany','productName','country','senderName','companyName'], true, 1, now(), now()),
('sys_tpl_sample', NULL, 'Sample offer', 'SAMPLE_OFFER',
 'Samples of {{productName}} for {{buyerCompany}}',
 E'Dear {{contactName}},\n\nTo help {{buyerCompany}} evaluate our {{productName}}, we can discuss arranging samples.\n\nPlease let me know the specification you would like to test and a delivery address in {{country}}, and we will confirm the details.\n\nKind regards,\n{{senderName}}\n{{companyName}}',
 'en', ARRAY['contactName','buyerCompany','productName','country','senderName','companyName'], true, 1, now(), now()),
('sys_tpl_followup', NULL, 'Gentle follow-up', 'FOLLOW_UP',
 'Re: {{productName}} for {{buyerCompany}}',
 E'Dear {{contactName}},\n\nI wanted to follow up on my earlier message about {{productName}}. If this is not a priority for {{buyerCompany}} right now, no problem — just let me know and I will not follow up again.\n\nBest regards,\n{{senderName}}\n{{companyName}}',
 'en', ARRAY['contactName','productName','buyerCompany','senderName','companyName'], true, 1, now(), now());

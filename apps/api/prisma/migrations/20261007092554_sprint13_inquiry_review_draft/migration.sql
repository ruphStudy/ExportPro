-- AlterTable
ALTER TABLE "buyer_inquiries" ADD COLUMN     "reviewDraft" JSONB,
ADD COLUMN     "reviewDraftAt" TIMESTAMP(3),
ADD COLUMN     "reviewDraftByUserId" TEXT;

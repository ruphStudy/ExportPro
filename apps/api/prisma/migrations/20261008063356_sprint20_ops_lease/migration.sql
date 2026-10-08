-- AlterTable
ALTER TABLE "ops_settings" ADD COLUMN     "evaluatingUntil" TIMESTAMPTZ(3),
ADD COLUMN     "templatesSeeded" BOOLEAN NOT NULL DEFAULT false;

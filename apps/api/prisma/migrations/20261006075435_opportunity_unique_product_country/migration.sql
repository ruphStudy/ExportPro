-- AlterTable
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_productName_destinationCountryCode_key" UNIQUE ("productName", "destinationCountryCode");

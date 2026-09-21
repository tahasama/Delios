-- AlterTable
ALTER TABLE "Approval" ADD COLUMN "withdrawnAt" DATETIME;
ALTER TABLE "Approval" ADD COLUMN "withdrawnBy" TEXT;
ALTER TABLE "Approval" ADD COLUMN "withdrawnReason" TEXT;

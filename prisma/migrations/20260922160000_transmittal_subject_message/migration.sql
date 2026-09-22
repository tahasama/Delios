-- AlterTable
ALTER TABLE "Transmittal" ADD COLUMN "message" TEXT;
ALTER TABLE "Transmittal" ADD COLUMN "subject" TEXT;

UPDATE "Transmittal" SET "message" = "acceptanceNotes" WHERE "direction" = 'OUTGOING' AND "acceptanceNotes" IS NOT NULL;

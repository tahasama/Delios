-- A released revision can be put on hold, not for use, while an outside
-- approval it turned out to need is awaited.
ALTER TABLE "Revision" ADD COLUMN "heldAt" DATETIME;
ALTER TABLE "Revision" ADD COLUMN "heldReason" TEXT;
ALTER TABLE "Revision" ADD COLUMN "heldByName" TEXT;

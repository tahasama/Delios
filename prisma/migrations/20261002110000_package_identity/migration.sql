-- A delivery package has a title and description, may go to several
-- organizations (one transmittal each), and is accepted at the end.
ALTER TABLE "Package" ADD COLUMN "title" TEXT;
ALTER TABLE "Package" ADD COLUMN "description" TEXT;
ALTER TABLE "Package" ADD COLUMN "recipientPartyIds" TEXT;
ALTER TABLE "Package" ADD COLUMN "acceptedAt" DATETIME;
ALTER TABLE "Package" ADD COLUMN "acceptedByName" TEXT;
ALTER TABLE "Transmittal" ADD COLUMN "packageId" TEXT;

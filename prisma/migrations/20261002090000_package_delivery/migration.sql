-- A delivery package is handed to an organization, by one transmittal.
ALTER TABLE "Package" ADD COLUMN "recipientPartyId" TEXT;
ALTER TABLE "Package" ADD COLUMN "deliveredAt" DATETIME;
ALTER TABLE "Package" ADD COLUMN "transmittalId" TEXT;

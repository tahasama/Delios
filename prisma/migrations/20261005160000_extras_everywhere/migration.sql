-- Answers to an organization's own fields, on every record a form fills.
ALTER TABLE "Revision" ADD COLUMN "extras" TEXT;
ALTER TABLE "Transmittal" ADD COLUMN "extras" TEXT;
ALTER TABLE "ReviewCycle" ADD COLUMN "extras" TEXT;
ALTER TABLE "Action" ADD COLUMN "extras" TEXT;
ALTER TABLE "Package" ADD COLUMN "extras" TEXT;
ALTER TABLE "Project" ADD COLUMN "extras" TEXT;
ALTER TABLE "Party" ADD COLUMN "extras" TEXT;
ALTER TABLE "User" ADD COLUMN "extras" TEXT;
ALTER TABLE "AssetItem" ADD COLUMN "extras" TEXT;

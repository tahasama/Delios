-- Stage 2: a step says what it does to the revision's status. The step keeps
-- what the route asked of it, and the revision keeps the status it currently
-- carries inside the route, apart from the status it has been granted.
ALTER TABLE "ReviewCycle" ADD COLUMN "handsOnStatus" TEXT;
ALTER TABLE "ReviewCycle" ADD COLUMN "grantsStatuses" TEXT;
ALTER TABLE "Revision" ADD COLUMN "handedOnStatus" TEXT;
ALTER TABLE "Revision" ADD COLUMN "proposedAt" DATETIME;
ALTER TABLE "Revision" ADD COLUMN "proposedByName" TEXT;

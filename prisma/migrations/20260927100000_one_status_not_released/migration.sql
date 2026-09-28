-- One status, carried the whole way through the route, and a state that says
-- whether anybody may act on it. What used to be the decided-but-unpublished
-- status becomes the revision's status; "Not released" becomes its state.
UPDATE "Revision" SET "statusCode" = "proposedStatus" WHERE "statusCode" IS NULL AND "proposedStatus" IS NOT NULL;
UPDATE "Revision" SET "state" = 'NOT_RELEASED' WHERE "state" = 'IN_REVIEW' AND "proposedStatus" IS NOT NULL;
ALTER TABLE "Revision" RENAME COLUMN "proposedAt" TO "statusSetAt";
ALTER TABLE "Revision" RENAME COLUMN "proposedByName" TO "statusSetByName";
ALTER TABLE "Revision" DROP COLUMN "proposedStatus";

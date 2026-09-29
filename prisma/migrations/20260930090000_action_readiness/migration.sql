-- Whether an action has what it needs is a question about every document on its
-- list. Kept on the action so the schedule can filter and page on it in the
-- database instead of loading itself into memory to answer.
ALTER TABLE "Action" ADD COLUMN "needCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Action" ADD COLUMN "metIssuedCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Action" ADD COLUMN "metStatusCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Action" ADD COLUMN "nextNeededAt" DATETIME;

-- What is on each list today.
UPDATE "Action" SET "needCount" = (
  SELECT COUNT(*) FROM "BaselineEntry" WHERE "BaselineEntry"."actionId" = "Action"."id"
);

-- Met, under the strict reading: a released revision at the status asked for.
UPDATE "Action" SET "metIssuedCount" = (
  SELECT COUNT(*) FROM "BaselineEntry" e
  WHERE e."actionId" = "Action"."id"
    AND EXISTS (
      SELECT 1 FROM "Revision" r
      WHERE r."documentId" = e."documentId" AND r."state" = 'RELEASED' AND r."statusCode" = e."requiredStatus"
    )
);

-- Met, under the other reading: the newest revision carries that status.
UPDATE "Action" SET "metStatusCount" = (
  SELECT COUNT(*) FROM "BaselineEntry" e
  WHERE e."actionId" = "Action"."id"
    AND (
      SELECT r."statusCode" FROM "Revision" r
      WHERE r."documentId" = e."documentId"
      ORDER BY r."createdAt" DESC LIMIT 1
    ) = e."requiredStatus"
);

-- The earliest day a document still missing is owed, under the strict reading.
UPDATE "Action" SET "nextNeededAt" = (
  SELECT MIN(e."requiredBy") FROM "BaselineEntry" e
  WHERE e."actionId" = "Action"."id"
    AND NOT EXISTS (
      SELECT 1 FROM "Revision" r
      WHERE r."documentId" = e."documentId" AND r."state" = 'RELEASED' AND r."statusCode" = e."requiredStatus"
    )
);

CREATE INDEX "Action_projectId_nextNeededAt_idx" ON "Action"("projectId", "nextNeededAt");

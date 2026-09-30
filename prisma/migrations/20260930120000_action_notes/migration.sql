-- The day the last document an action needs was released and issued: later than
-- the action's own date and the documents arrived after the work.
ALTER TABLE "Action" ADD COLUMN "lastMetAt" DATETIME;

UPDATE "Action" SET "lastMetAt" = (
  SELECT MAX(r."issuedAt") FROM "BaselineEntry" e
  JOIN "Revision" r ON r."documentId" = e."documentId"
   AND r."state" = 'RELEASED' AND r."statusCode" = e."requiredStatus"
  WHERE e."actionId" = "Action"."id"
);

-- What was decided about an action that did not have its documents: carried out
-- anyway or stopped, by whom, why, and who owns the delay behind it.
CREATE TABLE "ActionNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "plannedDate" DATETIME,
    "responsibleName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "delayResponsible" TEXT,
    "delayReason" TEXT,
    "recordedById" TEXT NOT NULL,
    "recordedByName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActionNote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ActionNote_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ActionNote_projectId_idx" ON "ActionNote"("projectId");
CREATE INDEX "ActionNote_actionId_idx" ON "ActionNote"("actionId");

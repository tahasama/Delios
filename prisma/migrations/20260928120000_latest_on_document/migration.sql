-- The latest revision's facts, kept on the document so the register can filter,
-- sort and page in SQL instead of reading every match into memory.
ALTER TABLE "Document" ADD COLUMN "latestRevisionId" TEXT;
ALTER TABLE "Document" ADD COLUMN "latestRevValue" TEXT;
ALTER TABLE "Document" ADD COLUMN "latestRevState" TEXT;
ALTER TABLE "Document" ADD COLUMN "latestStatusCode" TEXT;
ALTER TABLE "Document" ADD COLUMN "latestVerdict" TEXT;
ALTER TABLE "Document" ADD COLUMN "latestRevAt" DATETIME;
ALTER TABLE "Document" ADD COLUMN "latestFileAt" DATETIME;
ALTER TABLE "Document" ADD COLUMN "latestPlannedAt" DATETIME;
ALTER TABLE "Document" ADD COLUMN "latestIssueAt" DATETIME;
ALTER TABLE "Document" ADD COLUMN "latestReleasedAt" DATETIME;

CREATE INDEX "Document_projectId_updatedAt_idx" ON "Document"("projectId", "updatedAt");
CREATE INDEX "Document_projectId_docNumber_idx" ON "Document"("projectId", "docNumber");
CREATE INDEX "Document_originator_idx" ON "Document"("originator");
CREATE INDEX "Document_contractRef_idx" ON "Document"("contractRef");
CREATE INDEX "Document_deliverableType_idx" ON "Document"("deliverableType");
CREATE INDEX "Document_criticality_idx" ON "Document"("criticality");
CREATE INDEX "Document_confidentiality_idx" ON "Document"("confidentiality");
CREATE INDEX "Document_latestRevState_idx" ON "Document"("latestRevState");
CREATE INDEX "Document_latestStatusCode_idx" ON "Document"("latestStatusCode");
CREATE INDEX "Document_latestVerdict_idx" ON "Document"("latestVerdict");

CREATE INDEX "Revision_documentId_createdAt_idx" ON "Revision"("documentId", "createdAt");

-- Fill them from what is already recorded.
UPDATE "Document" SET
  "latestRevisionId" = (SELECT r."id" FROM "Revision" r WHERE r."documentId" = "Document"."id" ORDER BY r."createdAt" DESC LIMIT 1),
  "latestRevValue"   = (SELECT r."value" FROM "Revision" r WHERE r."documentId" = "Document"."id" ORDER BY r."createdAt" DESC LIMIT 1),
  "latestRevState"   = (SELECT r."state" FROM "Revision" r WHERE r."documentId" = "Document"."id" ORDER BY r."createdAt" DESC LIMIT 1),
  "latestStatusCode" = (SELECT r."statusCode" FROM "Revision" r WHERE r."documentId" = "Document"."id" ORDER BY r."createdAt" DESC LIMIT 1),
  "latestRevAt"      = (SELECT r."createdAt" FROM "Revision" r WHERE r."documentId" = "Document"."id" ORDER BY r."createdAt" DESC LIMIT 1),
  "latestPlannedAt"  = (SELECT r."plannedSubmissionDate" FROM "Revision" r WHERE r."documentId" = "Document"."id" ORDER BY r."createdAt" DESC LIMIT 1),
  "latestIssueAt"    = (SELECT r."issueDate" FROM "Revision" r WHERE r."documentId" = "Document"."id" ORDER BY r."createdAt" DESC LIMIT 1),
  "latestReleasedAt" = (SELECT r."releasedAt" FROM "Revision" r WHERE r."documentId" = "Document"."id" ORDER BY r."createdAt" DESC LIMIT 1);

UPDATE "Document" SET
  "latestFileAt" = (
    SELECT f."createdAt" FROM "StoredFile" f
    WHERE f."revisionId" = "Document"."latestRevisionId"
    ORDER BY f."createdAt" DESC LIMIT 1
  ),
  "latestVerdict" = (
    SELECT c."outcome" FROM "ReviewCycle" c
    WHERE c."revisionId" = "Document"."latestRevisionId" AND c."binding" = 1 AND c."outcome" IS NOT NULL
    ORDER BY c."sequence" DESC LIMIT 1
  )
WHERE "latestRevisionId" IS NOT NULL;

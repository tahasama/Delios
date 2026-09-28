-- Releasing a revision and telling people about it are two acts. The second is
-- asked for, by anyone with standing on the document, at any time, as often as
-- the work needs. What used to be a single instruction written by the deciding
-- step becomes the first of those requests.
CREATE TABLE "IssueRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ISSUE',
    "recipients" TEXT NOT NULL,
    "note" TEXT,
    "delegated" BOOLEAN NOT NULL DEFAULT false,
    "raisedById" TEXT NOT NULL,
    "raisedByName" TEXT NOT NULL,
    "raisedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "carriedOutAt" DATETIME,
    "carriedOutBy" TEXT,
    "transmittalId" TEXT,
    CONSTRAINT "IssueRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "IssueRequest_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "Revision" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "IssueRequest_transmittalId_fkey" FOREIGN KEY ("transmittalId") REFERENCES "Transmittal" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "IssueRequest_revisionId_idx" ON "IssueRequest"("revisionId");
CREATE INDEX "IssueRequest_projectId_status_idx" ON "IssueRequest"("projectId", "status");

-- Carry the instructions already recorded across as requests, so nothing that
-- was asked for is lost.
INSERT INTO "IssueRequest" ("id", "projectId", "revisionId", "kind", "recipients", "note", "delegated", "raisedById", "raisedByName", "raisedAt", "status")
SELECT lower(hex(randomblob(16))), "projectId", "id", 'ISSUE', "issueInstruction", NULL,
       CASE WHEN "issueInstruction" LIKE '%"delegatedToOriginator":true%' THEN 1 ELSE 0 END,
       '', COALESCE("issueInstructionBy", 'unknown'), COALESCE("issueInstructionAt", CURRENT_TIMESTAMP),
       CASE WHEN "state" = 'RELEASED' THEN 'DONE' ELSE 'OPEN' END
FROM "Revision" WHERE "issueInstruction" IS NOT NULL;

ALTER TABLE "Revision" DROP COLUMN "issueInstruction";
ALTER TABLE "Revision" DROP COLUMN "issueInstructionAt";
ALTER TABLE "Revision" DROP COLUMN "issueInstructionBy";

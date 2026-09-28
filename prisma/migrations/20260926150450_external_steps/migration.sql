-- AlterTable
ALTER TABLE "Revision" ADD COLUMN "authoredById" TEXT;
ALTER TABLE "Revision" ADD COLUMN "authoredByName" TEXT;
ALTER TABLE "Revision" ADD COLUMN "authoredByParty" TEXT;
ALTER TABLE "Revision" ADD COLUMN "uploadedById" TEXT;
ALTER TABLE "Revision" ADD COLUMN "uploadedByName" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Party" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "contactId" TEXT,
    "backupId" TEXT,
    "participation" TEXT NOT NULL DEFAULT 'IN_APP',
    "liaisonFunction" TEXT,
    "externalSystem" TEXT,
    "evidenceRequired" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Party_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Party_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Party_backupId_fkey" FOREIGN KEY ("backupId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Party" ("active", "backupId", "code", "contactId", "id", "isInternal", "name", "orgId") SELECT "active", "backupId", "code", "contactId", "id", "isInternal", "name", "orgId" FROM "Party";
DROP TABLE "Party";
ALTER TABLE "new_Party" RENAME TO "Party";
CREATE INDEX "Party_orgId_idx" ON "Party"("orgId");
CREATE UNIQUE INDEX "Party_orgId_code_key" ON "Party"("orgId", "code");
CREATE TABLE "new_ReviewCycle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'PARALLEL',
    "sequence" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "openedById" TEXT NOT NULL,
    "openedByName" TEXT NOT NULL,
    "transmittalId" TEXT,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedAt" DATETIME,
    "issuedToReviewAt" DATETIME,
    "returnedFromReviewAt" DATETIME,
    "returnedToOriginatorAt" DATETIME,
    "dueAt" DATETIME,
    "riskNotifiedAt" DATETIME,
    "outcome" TEXT,
    "outcomeSetKey" TEXT,
    "outcomeAt" DATETIME,
    "outcomeByName" TEXT,
    "outcomeNote" TEXT,
    "binding" BOOLEAN NOT NULL DEFAULT true,
    "partyId" TEXT,
    "dispatchedAt" DATETIME,
    "dispatchChannel" TEXT,
    "dispatchRef" TEXT,
    "recordedById" TEXT,
    "recordedByName" TEXT,
    "foreignOutcome" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewCycle_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReviewCycle_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "Revision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReviewCycle_transmittalId_fkey" FOREIGN KEY ("transmittalId") REFERENCES "Transmittal" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ReviewCycle_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ReviewCycle" ("binding", "createdAt", "dueAt", "id", "issuedToReviewAt", "mode", "openedById", "openedByName", "outcome", "outcomeAt", "outcomeByName", "outcomeNote", "outcomeSetKey", "projectId", "receivedAt", "returnedFromReviewAt", "returnedToOriginatorAt", "revisionId", "riskNotifiedAt", "sequence", "status", "submittedAt", "transmittalId") SELECT "binding", "createdAt", "dueAt", "id", "issuedToReviewAt", "mode", "openedById", "openedByName", "outcome", "outcomeAt", "outcomeByName", "outcomeNote", "outcomeSetKey", "projectId", "receivedAt", "returnedFromReviewAt", "returnedToOriginatorAt", "revisionId", "riskNotifiedAt", "sequence", "status", "submittedAt", "transmittalId" FROM "ReviewCycle";
DROP TABLE "ReviewCycle";
ALTER TABLE "new_ReviewCycle" RENAME TO "ReviewCycle";
CREATE INDEX "ReviewCycle_status_idx" ON "ReviewCycle"("status");
CREATE INDEX "ReviewCycle_revisionId_idx" ON "ReviewCycle"("revisionId");
CREATE INDEX "ReviewCycle_projectId_idx" ON "ReviewCycle"("projectId");
CREATE TABLE "new_StoredFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mime" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "revisionId" TEXT,
    "cycleId" TEXT,
    "uploadedById" TEXT,
    "uploadedByName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoredFile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoredFile_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "Revision" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StoredFile_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "ReviewCycle" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_StoredFile" ("createdAt", "id", "kind", "mime", "name", "path", "projectId", "revisionId", "sha256", "size", "uploadedById", "uploadedByName") SELECT "createdAt", "id", "kind", "mime", "name", "path", "projectId", "revisionId", "sha256", "size", "uploadedById", "uploadedByName" FROM "StoredFile";
DROP TABLE "StoredFile";
ALTER TABLE "new_StoredFile" RENAME TO "StoredFile";
CREATE INDEX "StoredFile_projectId_idx" ON "StoredFile"("projectId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "outcome" TEXT,
    "outcomeSetKey" TEXT,
    "outcomeAt" DATETIME,
    "outcomeByName" TEXT,
    "outcomeNote" TEXT,
    "binding" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewCycle_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReviewCycle_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "Revision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReviewCycle_transmittalId_fkey" FOREIGN KEY ("transmittalId") REFERENCES "Transmittal" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ReviewCycle" ("createdAt", "id", "issuedToReviewAt", "mode", "openedById", "openedByName", "outcome", "outcomeAt", "outcomeByName", "outcomeNote", "outcomeSetKey", "projectId", "receivedAt", "returnedFromReviewAt", "returnedToOriginatorAt", "revisionId", "sequence", "status", "submittedAt", "transmittalId") SELECT "createdAt", "id", "issuedToReviewAt", "mode", "openedById", "openedByName", "outcome", "outcomeAt", "outcomeByName", "outcomeNote", "outcomeSetKey", "projectId", "receivedAt", "returnedFromReviewAt", "returnedToOriginatorAt", "revisionId", "sequence", "status", "submittedAt", "transmittalId" FROM "ReviewCycle";
DROP TABLE "ReviewCycle";
ALTER TABLE "new_ReviewCycle" RENAME TO "ReviewCycle";
CREATE INDEX "ReviewCycle_status_idx" ON "ReviewCycle"("status");
CREATE INDEX "ReviewCycle_revisionId_idx" ON "ReviewCycle"("revisionId");
CREATE INDEX "ReviewCycle_projectId_idx" ON "ReviewCycle"("projectId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;


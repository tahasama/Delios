-- AlterTable
ALTER TABLE "PermissionRule" ADD COLUMN "projectRole" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Delegation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "scope" TEXT,
    "endDate" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verb" TEXT NOT NULL DEFAULT 'REVIEW',
    "cycleId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "reason" TEXT,
    "askedById" TEXT,
    "askedByName" TEXT,
    "grantedById" TEXT,
    "grantedByName" TEXT,
    "grantedAt" DATETIME,
    "refusedReason" TEXT,
    CONSTRAINT "Delegation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Delegation_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Delegation_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Delegation_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "ReviewCycle" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Delegation" ("askedById", "askedByName", "createdAt", "cycleId", "endDate", "fromUserId", "grantedAt", "grantedById", "grantedByName", "id", "projectId", "reason", "refusedReason", "scope", "status", "toUserId", "verb") SELECT "askedById", "askedByName", "createdAt", "cycleId", "endDate", "fromUserId", "grantedAt", "grantedById", "grantedByName", "id", "projectId", "reason", "refusedReason", "scope", "status", "toUserId", "verb" FROM "Delegation";
DROP TABLE "Delegation";
ALTER TABLE "new_Delegation" RENAME TO "Delegation";
CREATE INDEX "Delegation_projectId_idx" ON "Delegation"("projectId");
CREATE INDEX "Delegation_toUserId_status_idx" ON "Delegation"("toUserId", "status");
CREATE INDEX "Delegation_cycleId_idx" ON "Delegation"("cycleId");
CREATE TABLE "new_IssueRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'INFORMATION',
    "recipients" TEXT NOT NULL,
    "note" TEXT,
    "delegated" BOOLEAN NOT NULL DEFAULT false,
    "needsApproval" BOOLEAN NOT NULL DEFAULT false,
    "approverId" TEXT,
    "raisedById" TEXT NOT NULL,
    "raisedByName" TEXT NOT NULL,
    "raisedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "carriedOutAt" DATETIME,
    "carriedOutBy" TEXT,
    "transmittalId" TEXT,
    CONSTRAINT "IssueRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "IssueRequest_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "Revision" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "IssueRequest_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "Party" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "IssueRequest_transmittalId_fkey" FOREIGN KEY ("transmittalId") REFERENCES "Transmittal" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_IssueRequest" ("approverId", "carriedOutAt", "carriedOutBy", "delegated", "id", "needsApproval", "note", "projectId", "raisedAt", "raisedById", "raisedByName", "reason", "recipients", "revisionId", "status", "transmittalId") SELECT "approverId", "carriedOutAt", "carriedOutBy", "delegated", "id", "needsApproval", "note", "projectId", "raisedAt", "raisedById", "raisedByName", "reason", "recipients", "revisionId", "status", "transmittalId" FROM "IssueRequest";
DROP TABLE "IssueRequest";
ALTER TABLE "new_IssueRequest" RENAME TO "IssueRequest";
CREATE INDEX "IssueRequest_revisionId_idx" ON "IssueRequest"("revisionId");
CREATE INDEX "IssueRequest_projectId_status_idx" ON "IssueRequest"("projectId", "status");
CREATE TABLE "new_Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'GENERIC',
    "role" TEXT NOT NULL DEFAULT 'GENERIC',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startDate" DATETIME,
    "endDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Project_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Project" ("code", "createdAt", "id", "kind", "name", "orgId", "startDate", "status") SELECT "code", "createdAt", "id", "kind", "name", "orgId", "startDate", "status" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
CREATE INDEX "Project_orgId_idx" ON "Project"("orgId");
CREATE UNIQUE INDEX "Project_orgId_code_key" ON "Project"("orgId", "code");
CREATE TABLE "new_ReviewCycle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" TEXT,
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
    "grantsStatuses" TEXT,
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
    "issueRequestId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewCycle_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReviewCycle_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "Revision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReviewCycle_transmittalId_fkey" FOREIGN KEY ("transmittalId") REFERENCES "Transmittal" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ReviewCycle_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ReviewCycle_issueRequestId_fkey" FOREIGN KEY ("issueRequestId") REFERENCES "IssueRequest" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ReviewCycle" ("binding", "createdAt", "dispatchChannel", "dispatchRef", "dispatchedAt", "dueAt", "foreignOutcome", "grantsStatuses", "id", "issueRequestId", "issuedToReviewAt", "mode", "number", "openedById", "openedByName", "outcome", "outcomeAt", "outcomeByName", "outcomeNote", "outcomeSetKey", "partyId", "projectId", "receivedAt", "recordedById", "recordedByName", "returnedFromReviewAt", "returnedToOriginatorAt", "revisionId", "riskNotifiedAt", "sequence", "status", "submittedAt", "transmittalId") SELECT "binding", "createdAt", "dispatchChannel", "dispatchRef", "dispatchedAt", "dueAt", "foreignOutcome", "grantsStatuses", "id", "issueRequestId", "issuedToReviewAt", "mode", "number", "openedById", "openedByName", "outcome", "outcomeAt", "outcomeByName", "outcomeNote", "outcomeSetKey", "partyId", "projectId", "receivedAt", "recordedById", "recordedByName", "returnedFromReviewAt", "returnedToOriginatorAt", "revisionId", "riskNotifiedAt", "sequence", "status", "submittedAt", "transmittalId" FROM "ReviewCycle";
DROP TABLE "ReviewCycle";
ALTER TABLE "new_ReviewCycle" RENAME TO "ReviewCycle";
CREATE INDEX "ReviewCycle_status_idx" ON "ReviewCycle"("status");
CREATE INDEX "ReviewCycle_revisionId_idx" ON "ReviewCycle"("revisionId");
CREATE INDEX "ReviewCycle_projectId_idx" ON "ReviewCycle"("projectId");
CREATE INDEX "ReviewCycle_projectId_submittedAt_idx" ON "ReviewCycle"("projectId", "submittedAt");
CREATE INDEX "ReviewCycle_status_submittedAt_idx" ON "ReviewCycle"("status", "submittedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

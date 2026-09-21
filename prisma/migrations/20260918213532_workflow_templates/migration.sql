-- CreateTable
CREATE TABLE "WorkflowTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "classes" TEXT NOT NULL DEFAULT '*',
    "steps" TEXT NOT NULL,
    "outcomeSetKey" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "WorkflowRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "revisionId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateName" TEXT NOT NULL,
    "steps" TEXT NOT NULL,
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startedById" TEXT NOT NULL,
    "startedByName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkflowRun_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "Revision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Party" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ScopeConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationName" TEXT NOT NULL,
    "scopeStatement" TEXT NOT NULL,
    "assessmentLevel" TEXT NOT NULL,
    "standardVersion" TEXT NOT NULL,
    "effectiveDate" DATETIME NOT NULL,
    "integrityThreshold" REAL NOT NULL DEFAULT 95,
    "measurementIntervalDays" INTEGER NOT NULL DEFAULT 30,
    "controlFunctionName" TEXT NOT NULL DEFAULT 'Document Control',
    "defectAcceptanceRole" TEXT NOT NULL DEFAULT 'CONTROLLER',
    "submitRoles" TEXT NOT NULL DEFAULT '["AUTHOR","CONTROLLER","ADMIN"]',
    "externalInitiation" BOOLEAN NOT NULL DEFAULT false,
    "executionSeriesStart" INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "new_ScopeConfig" ("assessmentLevel", "controlFunctionName", "defectAcceptanceRole", "effectiveDate", "executionSeriesStart", "id", "integrityThreshold", "measurementIntervalDays", "organizationName", "scopeStatement", "standardVersion") SELECT "assessmentLevel", "controlFunctionName", "defectAcceptanceRole", "effectiveDate", "executionSeriesStart", "id", "integrityThreshold", "measurementIntervalDays", "organizationName", "scopeStatement", "standardVersion" FROM "ScopeConfig";
DROP TABLE "ScopeConfig";
ALTER TABLE "new_ScopeConfig" RENAME TO "ScopeConfig";
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "organization" TEXT,
    "partyId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("active", "createdAt", "email", "id", "name", "organization", "passwordHash", "role") SELECT "active", "createdAt", "email", "id", "name", "organization", "passwordHash", "role" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "WorkflowRun_revisionId_idx" ON "WorkflowRun"("revisionId");

-- CreateIndex
CREATE INDEX "WorkflowRun_status_idx" ON "WorkflowRun"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Party_code_key" ON "Party"("code");

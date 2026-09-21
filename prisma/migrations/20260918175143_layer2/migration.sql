-- AlterTable
ALTER TABLE "ReviewComment" ADD COLUMN "originalProgressionPreventing" BOOLEAN;
ALTER TABLE "ReviewComment" ADD COLUMN "reclassifiedAt" DATETIME;
ALTER TABLE "ReviewComment" ADD COLUMN "reclassifiedByName" TEXT;

-- CreateTable
CREATE TABLE "DistributionRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deliverableType" TEXT NOT NULL,
    "confidentiality" TEXT NOT NULL DEFAULT 'INTERNAL',
    "userIds" TEXT NOT NULL,
    "partyNames" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "NumberRange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "prefix" TEXT NOT NULL,
    "from" INTEGER NOT NULL,
    "to" INTEGER NOT NULL,
    "lastIssued" INTEGER NOT NULL DEFAULT -1,
    "issuedTo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SpineLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ruleId" TEXT NOT NULL,
    "checkId" TEXT,
    "routeId" TEXT,
    "alignment" TEXT NOT NULL DEFAULT 'ALIGNED',
    "reason" TEXT,
    "owner" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "docNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "deliverableType" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "discipline" TEXT NOT NULL,
    "originator" TEXT,
    "subProject" TEXT,
    "contractRef" TEXT,
    "criticality" TEXT,
    "confidentiality" TEXT,
    "retentionClass" TEXT,
    "state" TEXT NOT NULL DEFAULT 'PLANNED',
    "kind" TEXT NOT NULL DEFAULT 'DOCUMENT',
    "confirmedAt" DATETIME,
    "confirmedByName" TEXT,
    "disposedAt" DATETIME,
    "disposedBy" TEXT,
    "disposalBasis" TEXT,
    "legalHold" BOOLEAN NOT NULL DEFAULT false,
    "isPlaceholder" BOOLEAN NOT NULL DEFAULT false,
    "previousId" TEXT,
    "legacyScheme" TEXT,
    "createdDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedDate" DATETIME,
    "appVersion" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Document" ("appVersion", "confidentiality", "contractRef", "createdAt", "createdById", "createdByName", "createdDate", "criticality", "deliverableType", "discipline", "docNumber", "docType", "id", "isPlaceholder", "legacyScheme", "originator", "previousId", "receivedDate", "retentionClass", "state", "subProject", "title", "updatedAt") SELECT "appVersion", "confidentiality", "contractRef", "createdAt", "createdById", "createdByName", "createdDate", "criticality", "deliverableType", "discipline", "docNumber", "docType", "id", "isPlaceholder", "legacyScheme", "originator", "previousId", "receivedDate", "retentionClass", "state", "subProject", "title", "updatedAt" FROM "Document";
DROP TABLE "Document";
ALTER TABLE "new_Document" RENAME TO "Document";
CREATE UNIQUE INDEX "Document_docNumber_key" ON "Document"("docNumber");
CREATE INDEX "Document_state_idx" ON "Document"("state");
CREATE INDEX "Document_discipline_idx" ON "Document"("discipline");
CREATE INDEX "Document_docType_idx" ON "Document"("docType");
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
    "executionSeriesStart" INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "new_ScopeConfig" ("assessmentLevel", "controlFunctionName", "effectiveDate", "id", "integrityThreshold", "measurementIntervalDays", "organizationName", "scopeStatement", "standardVersion") SELECT "assessmentLevel", "controlFunctionName", "effectiveDate", "id", "integrityThreshold", "measurementIntervalDays", "organizationName", "scopeStatement", "standardVersion" FROM "ScopeConfig";
DROP TABLE "ScopeConfig";
ALTER TABLE "new_ScopeConfig" RENAME TO "ScopeConfig";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "DistributionRule_deliverableType_confidentiality_key" ON "DistributionRule"("deliverableType", "confidentiality");

-- CreateIndex
CREATE INDEX "NumberRange_prefix_idx" ON "NumberRange"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "SpineLink_ruleId_checkId_key" ON "SpineLink"("ruleId", "checkId");

/*
  Warnings:

  - The primary key for the `ConfigSet` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - Added the required column `projectId` to the `Action` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectId` to the `Approval` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectId` to the `AssetItem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectId` to the `AuditEvent` table without a default value. This is not possible if the table is not empty.
  - Added the required column `orgId` to the `AuthorityRow` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectId` to the `BaselineEntry` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectId` to the `CheckRun` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectId` to the `CheckRunItem` table without a default value. This is not possible if the table is not empty.
  - The required column `id` was added to the `ConfigSet` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - Added the required column `orgId` to the `ConfigSet` table without a default value. This is not possible if the table is not empty.
  - Added the required column `orgId` to the `ConfigValue` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectId` to the `Defect` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectId` to the `Delegation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectId` to the `DistributionRule` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectId` to the `Document` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectId` to the `DocumentSnapshot` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectId` to the `ExceptionEntry` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectId` to the `Notification` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectId` to the `NumberCounter` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectId` to the `NumberRange` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectId` to the `ObsolescenceRecord` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectId` to the `Package` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectId` to the `PackageMember` table without a default value. This is not possible if the table is not empty.
  - Added the required column `orgId` to the `Party` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectId` to the `RegisteredCopy` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectId` to the `Relationship` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectId` to the `ReviewAssignment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectId` to the `ReviewComment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectId` to the `ReviewCycle` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectId` to the `Revision` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectId` to the `ScheduleActivity` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectId` to the `ScheduleVersion` table without a default value. This is not possible if the table is not empty.
  - Added the required column `orgId` to the `Scheme` table without a default value. This is not possible if the table is not empty.
  - Added the required column `orgId` to the `SchemeRouting` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectId` to the `ScopeConfig` table without a default value. This is not possible if the table is not empty.
  - Added the required column `orgId` to the `SpineLink` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectId` to the `StoredFile` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectId` to the `Transmittal` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectId` to the `TransmittalItem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectId` to the `TransmittalRecipient` table without a default value. This is not possible if the table is not empty.
  - Added the required column `orgId` to the `User` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectId` to the `WorkflowRun` table without a default value. This is not possible if the table is not empty.
  - Added the required column `orgId` to the `WorkflowTemplate` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'GENERIC',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Project_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectMembership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectMembership_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Action" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scheduledDate" DATETIME,
    "ownerName" TEXT,
    "scheduleRef" TEXT,
    "leadTimeDays" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Action_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Action" ("code", "createdAt", "id", "leadTimeDays", "name", "ownerName", "scheduleRef", "scheduledDate") SELECT "code", "createdAt", "id", "leadTimeDays", "name", "ownerName", "scheduleRef", "scheduledDate" FROM "Action";
DROP TABLE "Action";
ALTER TABLE "new_Action" RENAME TO "Action";
CREATE INDEX "Action_projectId_idx" ON "Action"("projectId");
CREATE UNIQUE INDEX "Action_projectId_code_key" ON "Action"("projectId", "code");
CREATE TABLE "new_Approval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "approverName" TEXT NOT NULL,
    "approverRole" TEXT NOT NULL,
    "matrixVersion" INTEGER NOT NULL,
    "decidedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "withdrawnAt" DATETIME,
    "withdrawnBy" TEXT,
    "withdrawnReason" TEXT,
    CONSTRAINT "Approval_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Approval_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "Revision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Approval_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Approval" ("approverId", "approverName", "approverRole", "decidedAt", "id", "matrixVersion", "note", "revisionId", "withdrawnAt", "withdrawnBy", "withdrawnReason") SELECT "approverId", "approverName", "approverRole", "decidedAt", "id", "matrixVersion", "note", "revisionId", "withdrawnAt", "withdrawnBy", "withdrawnReason" FROM "Approval";
DROP TABLE "Approval";
ALTER TABLE "new_Approval" RENAME TO "Approval";
CREATE INDEX "Approval_revisionId_idx" ON "Approval"("revisionId");
CREATE INDEX "Approval_projectId_idx" ON "Approval"("projectId");
CREATE TABLE "new_AssetItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "area" TEXT,
    "system" TEXT,
    "unit" TEXT,
    CONSTRAINT "AssetItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AssetItem" ("area", "code", "id", "name", "system", "unit") SELECT "area", "code", "id", "name", "system", "unit" FROM "AssetItem";
DROP TABLE "AssetItem";
ALTER TABLE "new_AssetItem" RENAME TO "AssetItem";
CREATE INDEX "AssetItem_projectId_idx" ON "AssetItem"("projectId");
CREATE UNIQUE INDEX "AssetItem_projectId_code_key" ON "AssetItem"("projectId", "code");
CREATE TABLE "new_AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "ts" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "entityLabel" TEXT,
    "field" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "detail" TEXT,
    CONSTRAINT "AuditEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AuditEvent" ("action", "actorId", "actorName", "detail", "entityId", "entityLabel", "entityType", "field", "id", "newValue", "oldValue", "ts") SELECT "action", "actorId", "actorName", "detail", "entityId", "entityLabel", "entityType", "field", "id", "newValue", "oldValue", "ts" FROM "AuditEvent";
DROP TABLE "AuditEvent";
ALTER TABLE "new_AuditEvent" RENAME TO "AuditEvent";
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");
CREATE INDEX "AuditEvent_ts_idx" ON "AuditEvent"("ts");
CREATE INDEX "AuditEvent_projectId_idx" ON "AuditEvent"("projectId");
CREATE TABLE "new_AuthorityRow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "discipline" TEXT,
    "docType" TEXT,
    "criticality" TEXT,
    "minRole" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthorityRow_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AuthorityRow" ("active", "createdAt", "criticality", "discipline", "docType", "id", "minRole", "version") SELECT "active", "createdAt", "criticality", "discipline", "docType", "id", "minRole", "version" FROM "AuthorityRow";
DROP TABLE "AuthorityRow";
ALTER TABLE "new_AuthorityRow" RENAME TO "AuthorityRow";
CREATE INDEX "AuthorityRow_orgId_idx" ON "AuthorityRow"("orgId");
CREATE TABLE "new_BaselineEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "requiredStatus" TEXT NOT NULL,
    "requiredBy" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByName" TEXT,
    CONSTRAINT "BaselineEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BaselineEntry_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BaselineEntry_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_BaselineEntry" ("actionId", "createdAt", "createdByName", "documentId", "id", "requiredBy", "requiredStatus") SELECT "actionId", "createdAt", "createdByName", "documentId", "id", "requiredBy", "requiredStatus" FROM "BaselineEntry";
DROP TABLE "BaselineEntry";
ALTER TABLE "new_BaselineEntry" RENAME TO "BaselineEntry";
CREATE INDEX "BaselineEntry_documentId_idx" ON "BaselineEntry"("documentId");
CREATE INDEX "BaselineEntry_projectId_idx" ON "BaselineEntry"("projectId");
CREATE UNIQUE INDEX "BaselineEntry_projectId_actionId_documentId_key" ON "BaselineEntry"("projectId", "actionId", "documentId");
CREATE TABLE "new_CheckRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "ranAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ranByName" TEXT,
    "totalChecks" INTEGER NOT NULL,
    "executed" INTEGER NOT NULL,
    "passed" INTEGER NOT NULL,
    "failed" INTEGER NOT NULL,
    "notChecked" INTEGER NOT NULL,
    "notExecutable" INTEGER NOT NULL,
    "integrity" REAL NOT NULL,
    "coverage" REAL NOT NULL,
    "openCritical" INTEGER NOT NULL,
    "durationMs" INTEGER,
    CONSTRAINT "CheckRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CheckRun" ("coverage", "durationMs", "executed", "failed", "id", "integrity", "notChecked", "notExecutable", "openCritical", "passed", "ranAt", "ranByName", "totalChecks") SELECT "coverage", "durationMs", "executed", "failed", "id", "integrity", "notChecked", "notExecutable", "openCritical", "passed", "ranAt", "ranByName", "totalChecks" FROM "CheckRun";
DROP TABLE "CheckRun";
ALTER TABLE "new_CheckRun" RENAME TO "CheckRun";
CREATE INDEX "CheckRun_projectId_idx" ON "CheckRun"("projectId");
CREATE TABLE "new_CheckRunItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "failingCount" INTEGER NOT NULL DEFAULT 0,
    "ms" INTEGER,
    CONSTRAINT "CheckRunItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CheckRunItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CheckRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_CheckRunItem" ("checkId", "failingCount", "id", "ms", "result", "runId") SELECT "checkId", "failingCount", "id", "ms", "result", "runId" FROM "CheckRunItem";
DROP TABLE "CheckRunItem";
ALTER TABLE "new_CheckRunItem" RENAME TO "CheckRunItem";
CREATE INDEX "CheckRunItem_runId_idx" ON "CheckRunItem"("runId");
CREATE INDEX "CheckRunItem_projectId_idx" ON "CheckRunItem"("projectId");
CREATE TABLE "new_ConfigSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "ConfigSet_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ConfigSet" ("description", "key", "title", "version") SELECT "description", "key", "title", "version" FROM "ConfigSet";
DROP TABLE "ConfigSet";
ALTER TABLE "new_ConfigSet" RENAME TO "ConfigSet";
CREATE INDEX "ConfigSet_orgId_idx" ON "ConfigSet"("orgId");
CREATE UNIQUE INDEX "ConfigSet_orgId_key_key" ON "ConfigSet"("orgId", "key");
CREATE TABLE "new_ConfigValue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "setKey" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "props" TEXT,
    CONSTRAINT "ConfigValue_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ConfigValue_orgId_setKey_fkey" FOREIGN KEY ("orgId", "setKey") REFERENCES "ConfigSet" ("orgId", "key") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ConfigValue" ("code", "id", "label", "props", "setKey", "sort", "status") SELECT "code", "id", "label", "props", "setKey", "sort", "status" FROM "ConfigValue";
DROP TABLE "ConfigValue";
ALTER TABLE "new_ConfigValue" RENAME TO "ConfigValue";
CREATE INDEX "ConfigValue_orgId_setKey_idx" ON "ConfigValue"("orgId", "setKey");
CREATE UNIQUE INDEX "ConfigValue_orgId_setKey_code_key" ON "ConfigValue"("orgId", "setKey", "code");
CREATE TABLE "new_Defect" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "entityKey" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "documentId" TEXT,
    "entityLabel" TEXT,
    "description" TEXT NOT NULL,
    "ownerRole" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedByName" TEXT,
    "acceptedReason" TEXT,
    "acceptedAt" DATETIME,
    "reviewDate" DATETIME,
    "closedAt" DATETIME,
    CONSTRAINT "Defect_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Defect_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Defect" ("acceptedAt", "acceptedByName", "acceptedReason", "checkId", "closedAt", "description", "documentId", "entityId", "entityKey", "entityLabel", "entityType", "firstSeenAt", "id", "lastSeenAt", "ownerRole", "reviewDate", "severity", "status") SELECT "acceptedAt", "acceptedByName", "acceptedReason", "checkId", "closedAt", "description", "documentId", "entityId", "entityKey", "entityLabel", "entityType", "firstSeenAt", "id", "lastSeenAt", "ownerRole", "reviewDate", "severity", "status" FROM "Defect";
DROP TABLE "Defect";
ALTER TABLE "new_Defect" RENAME TO "Defect";
CREATE INDEX "Defect_status_idx" ON "Defect"("status");
CREATE INDEX "Defect_documentId_idx" ON "Defect"("documentId");
CREATE INDEX "Defect_projectId_idx" ON "Defect"("projectId");
CREATE UNIQUE INDEX "Defect_projectId_checkId_entityKey_key" ON "Defect"("projectId", "checkId", "entityKey");
CREATE TABLE "new_Delegation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "scope" TEXT,
    "endDate" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Delegation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Delegation_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Delegation_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Delegation" ("createdAt", "endDate", "fromUserId", "id", "scope", "toUserId") SELECT "createdAt", "endDate", "fromUserId", "id", "scope", "toUserId" FROM "Delegation";
DROP TABLE "Delegation";
ALTER TABLE "new_Delegation" RENAME TO "Delegation";
CREATE INDEX "Delegation_projectId_idx" ON "Delegation"("projectId");
CREATE TABLE "new_DistributionRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "deliverableType" TEXT NOT NULL,
    "confidentiality" TEXT NOT NULL DEFAULT 'INTERNAL',
    "userIds" TEXT NOT NULL,
    "partyNames" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DistributionRule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DistributionRule" ("confidentiality", "deliverableType", "id", "partyNames", "updatedAt", "userIds") SELECT "confidentiality", "deliverableType", "id", "partyNames", "updatedAt", "userIds" FROM "DistributionRule";
DROP TABLE "DistributionRule";
ALTER TABLE "new_DistributionRule" RENAME TO "DistributionRule";
CREATE INDEX "DistributionRule_projectId_idx" ON "DistributionRule"("projectId");
CREATE UNIQUE INDEX "DistributionRule_projectId_deliverableType_confidentiality_key" ON "DistributionRule"("projectId", "deliverableType", "confidentiality");
CREATE TABLE "new_Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
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
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Document_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Document" ("appVersion", "confidentiality", "confirmedAt", "confirmedByName", "contractRef", "createdAt", "createdById", "createdByName", "createdDate", "criticality", "deliverableType", "discipline", "disposalBasis", "disposedAt", "disposedBy", "docNumber", "docType", "id", "isPlaceholder", "kind", "legacyScheme", "legalHold", "originator", "previousId", "receivedDate", "retentionClass", "state", "subProject", "title", "updatedAt") SELECT "appVersion", "confidentiality", "confirmedAt", "confirmedByName", "contractRef", "createdAt", "createdById", "createdByName", "createdDate", "criticality", "deliverableType", "discipline", "disposalBasis", "disposedAt", "disposedBy", "docNumber", "docType", "id", "isPlaceholder", "kind", "legacyScheme", "legalHold", "originator", "previousId", "receivedDate", "retentionClass", "state", "subProject", "title", "updatedAt" FROM "Document";
DROP TABLE "Document";
ALTER TABLE "new_Document" RENAME TO "Document";
CREATE INDEX "Document_state_idx" ON "Document"("state");
CREATE INDEX "Document_discipline_idx" ON "Document"("discipline");
CREATE INDEX "Document_docType_idx" ON "Document"("docType");
CREATE INDEX "Document_projectId_idx" ON "Document"("projectId");
CREATE UNIQUE INDEX "Document_projectId_docNumber_key" ON "Document"("projectId", "docNumber");
CREATE TABLE "new_DocumentSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "revisionId" TEXT,
    "auditEventId" TEXT,
    "eventType" TEXT NOT NULL,
    "eventLabel" TEXT,
    "actorName" TEXT NOT NULL,
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" TEXT NOT NULL,
    CONSTRAINT "DocumentSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DocumentSnapshot_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DocumentSnapshot" ("actorName", "auditEventId", "capturedAt", "documentId", "eventLabel", "eventType", "id", "payload", "revisionId") SELECT "actorName", "auditEventId", "capturedAt", "documentId", "eventLabel", "eventType", "id", "payload", "revisionId" FROM "DocumentSnapshot";
DROP TABLE "DocumentSnapshot";
ALTER TABLE "new_DocumentSnapshot" RENAME TO "DocumentSnapshot";
CREATE INDEX "DocumentSnapshot_documentId_capturedAt_idx" ON "DocumentSnapshot"("documentId", "capturedAt");
CREATE INDEX "DocumentSnapshot_revisionId_idx" ON "DocumentSnapshot"("revisionId");
CREATE INDEX "DocumentSnapshot_auditEventId_idx" ON "DocumentSnapshot"("auditEventId");
CREATE INDEX "DocumentSnapshot_projectId_idx" ON "DocumentSnapshot"("projectId");
CREATE TABLE "new_ExceptionEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "clauses" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "authority" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "reviewPoint" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExceptionEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ExceptionEntry" ("authority", "clauses", "createdAt", "id", "item", "reason", "reviewPoint", "startDate") SELECT "authority", "clauses", "createdAt", "id", "item", "reason", "reviewPoint", "startDate" FROM "ExceptionEntry";
DROP TABLE "ExceptionEntry";
ALTER TABLE "new_ExceptionEntry" RENAME TO "ExceptionEntry";
CREATE INDEX "ExceptionEntry_projectId_idx" ON "ExceptionEntry"("projectId");
CREATE TABLE "new_Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Notification" ("body", "createdAt", "id", "link", "read", "title", "type", "userId") SELECT "body", "createdAt", "id", "link", "read", "title", "type", "userId" FROM "Notification";
DROP TABLE "Notification";
ALTER TABLE "new_Notification" RENAME TO "Notification";
CREATE INDEX "Notification_userId_read_idx" ON "Notification"("userId", "read");
CREATE INDEX "Notification_projectId_idx" ON "Notification"("projectId");
CREATE TABLE "new_NumberCounter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "NumberCounter_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_NumberCounter" ("id", "next", "prefix") SELECT "id", "next", "prefix" FROM "NumberCounter";
DROP TABLE "NumberCounter";
ALTER TABLE "new_NumberCounter" RENAME TO "NumberCounter";
CREATE INDEX "NumberCounter_projectId_idx" ON "NumberCounter"("projectId");
CREATE UNIQUE INDEX "NumberCounter_projectId_prefix_key" ON "NumberCounter"("projectId", "prefix");
CREATE TABLE "new_NumberRange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "from" INTEGER NOT NULL,
    "to" INTEGER NOT NULL,
    "lastIssued" INTEGER NOT NULL DEFAULT -1,
    "issuedTo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NumberRange_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_NumberRange" ("createdAt", "from", "id", "issuedTo", "lastIssued", "prefix", "status", "to") SELECT "createdAt", "from", "id", "issuedTo", "lastIssued", "prefix", "status", "to" FROM "NumberRange";
DROP TABLE "NumberRange";
ALTER TABLE "new_NumberRange" RENAME TO "NumberRange";
CREATE INDEX "NumberRange_prefix_idx" ON "NumberRange"("prefix");
CREATE INDEX "NumberRange_projectId_idx" ON "NumberRange"("projectId");
CREATE TABLE "new_ObsolescenceRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "documentId" TEXT,
    "revisionId" TEXT,
    "reason" TEXT NOT NULL,
    "authorityName" TEXT NOT NULL,
    "effectiveDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ObsolescenceRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ObsolescenceRecord" ("authorityName", "createdAt", "createdById", "documentId", "effectiveDate", "id", "kind", "reason", "revisionId") SELECT "authorityName", "createdAt", "createdById", "documentId", "effectiveDate", "id", "kind", "reason", "revisionId" FROM "ObsolescenceRecord";
DROP TABLE "ObsolescenceRecord";
ALTER TABLE "new_ObsolescenceRecord" RENAME TO "ObsolescenceRecord";
CREATE INDEX "ObsolescenceRecord_projectId_idx" ON "ObsolescenceRecord"("projectId");
CREATE TABLE "new_Package" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "membershipRule" TEXT,
    "recipientName" TEXT NOT NULL,
    "completionDate" DATETIME NOT NULL,
    "requiredStatus" TEXT NOT NULL,
    "compositionOwnerId" TEXT NOT NULL,
    "compositionOwnerName" TEXT NOT NULL,
    "acceptanceAuthorityId" TEXT NOT NULL,
    "acceptanceAuthorityName" TEXT NOT NULL,
    "closedAt" DATETIME,
    "closureNote" TEXT,
    "ruleCeasedAt" DATETIME,
    "assessedAt" DATETIME,
    "shortfall" TEXT,
    "shortfallIssuedAt" DATETIME,
    "shortfallAcceptedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Package_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Package" ("acceptanceAuthorityId", "acceptanceAuthorityName", "assessedAt", "closedAt", "closureNote", "completionDate", "compositionOwnerId", "compositionOwnerName", "createdAt", "id", "identifier", "membershipRule", "purpose", "recipientName", "requiredStatus", "ruleCeasedAt", "shortfall", "shortfallAcceptedBy", "shortfallIssuedAt", "type") SELECT "acceptanceAuthorityId", "acceptanceAuthorityName", "assessedAt", "closedAt", "closureNote", "completionDate", "compositionOwnerId", "compositionOwnerName", "createdAt", "id", "identifier", "membershipRule", "purpose", "recipientName", "requiredStatus", "ruleCeasedAt", "shortfall", "shortfallAcceptedBy", "shortfallIssuedAt", "type" FROM "Package";
DROP TABLE "Package";
ALTER TABLE "new_Package" RENAME TO "Package";
CREATE INDEX "Package_type_idx" ON "Package"("type");
CREATE INDEX "Package_projectId_idx" ON "Package"("projectId");
CREATE UNIQUE INDEX "Package_projectId_identifier_key" ON "Package"("projectId", "identifier");
CREATE TABLE "new_PackageMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "requiredStatus" TEXT NOT NULL,
    "completionDate" DATETIME,
    CONSTRAINT "PackageMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PackageMember_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PackageMember_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_PackageMember" ("completionDate", "documentId", "id", "packageId", "requiredStatus") SELECT "completionDate", "documentId", "id", "packageId", "requiredStatus" FROM "PackageMember";
DROP TABLE "PackageMember";
ALTER TABLE "new_PackageMember" RENAME TO "PackageMember";
CREATE INDEX "PackageMember_documentId_idx" ON "PackageMember"("documentId");
CREATE INDEX "PackageMember_projectId_idx" ON "PackageMember"("projectId");
CREATE UNIQUE INDEX "PackageMember_projectId_packageId_documentId_key" ON "PackageMember"("projectId", "packageId", "documentId");
CREATE TABLE "new_Party" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Party_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Party" ("code", "id", "isInternal", "name") SELECT "code", "id", "isInternal", "name" FROM "Party";
DROP TABLE "Party";
ALTER TABLE "new_Party" RENAME TO "Party";
CREATE INDEX "Party_orgId_idx" ON "Party"("orgId");
CREATE UNIQUE INDEX "Party_orgId_code_key" ON "Party"("orgId", "code");
CREATE TABLE "new_RegisteredCopy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "actionRecord" TEXT,
    "actionDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RegisteredCopy_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RegisteredCopy_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "Revision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_RegisteredCopy" ("actionDate", "actionRecord", "createdAt", "holder", "id", "location", "revisionId", "status") SELECT "actionDate", "actionRecord", "createdAt", "holder", "id", "location", "revisionId", "status" FROM "RegisteredCopy";
DROP TABLE "RegisteredCopy";
ALTER TABLE "new_RegisteredCopy" RENAME TO "RegisteredCopy";
CREATE INDEX "RegisteredCopy_revisionId_idx" ON "RegisteredCopy"("revisionId");
CREATE INDEX "RegisteredCopy_projectId_idx" ON "RegisteredCopy"("projectId");
CREATE TABLE "new_Relationship" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fromType" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toType" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Relationship_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Relationship" ("createdAt", "createdById", "fromId", "fromType", "id", "kind", "note", "toId", "toType") SELECT "createdAt", "createdById", "fromId", "fromType", "id", "kind", "note", "toId", "toType" FROM "Relationship";
DROP TABLE "Relationship";
ALTER TABLE "new_Relationship" RENAME TO "Relationship";
CREATE INDEX "Relationship_kind_toId_idx" ON "Relationship"("kind", "toId");
CREATE INDEX "Relationship_fromId_idx" ON "Relationship"("fromId");
CREATE INDEX "Relationship_projectId_idx" ON "Relationship"("projectId");
CREATE TABLE "new_ReviewAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 1,
    "completedAt" DATETIME,
    CONSTRAINT "ReviewAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReviewAssignment_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "ReviewCycle" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ReviewAssignment" ("completedAt", "cycleId", "id", "order", "userId", "userName") SELECT "completedAt", "cycleId", "id", "order", "userId", "userName" FROM "ReviewAssignment";
DROP TABLE "ReviewAssignment";
ALTER TABLE "new_ReviewAssignment" RENAME TO "ReviewAssignment";
CREATE INDEX "ReviewAssignment_projectId_idx" ON "ReviewAssignment"("projectId");
CREATE TABLE "new_ReviewComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "progressionPreventing" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "closedAt" DATETIME,
    "reclassifiedAt" DATETIME,
    "reclassifiedByName" TEXT,
    "originalProgressionPreventing" BOOLEAN,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewComment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReviewComment_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "ReviewCycle" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ReviewComment" ("authorId", "authorName", "classification", "closedAt", "createdAt", "cycleId", "id", "originalProgressionPreventing", "progressionPreventing", "reclassifiedAt", "reclassifiedByName", "resolution", "status", "text") SELECT "authorId", "authorName", "classification", "closedAt", "createdAt", "cycleId", "id", "originalProgressionPreventing", "progressionPreventing", "reclassifiedAt", "reclassifiedByName", "resolution", "status", "text" FROM "ReviewComment";
DROP TABLE "ReviewComment";
ALTER TABLE "new_ReviewComment" RENAME TO "ReviewComment";
CREATE INDEX "ReviewComment_cycleId_idx" ON "ReviewComment"("cycleId");
CREATE INDEX "ReviewComment_status_idx" ON "ReviewComment"("status");
CREATE INDEX "ReviewComment_projectId_idx" ON "ReviewComment"("projectId");
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewCycle_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReviewCycle_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "Revision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReviewCycle_transmittalId_fkey" FOREIGN KEY ("transmittalId") REFERENCES "Transmittal" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ReviewCycle" ("createdAt", "id", "issuedToReviewAt", "mode", "openedById", "openedByName", "outcome", "outcomeAt", "outcomeByName", "outcomeNote", "outcomeSetKey", "receivedAt", "returnedFromReviewAt", "returnedToOriginatorAt", "revisionId", "sequence", "status", "submittedAt", "transmittalId") SELECT "createdAt", "id", "issuedToReviewAt", "mode", "openedById", "openedByName", "outcome", "outcomeAt", "outcomeByName", "outcomeNote", "outcomeSetKey", "receivedAt", "returnedFromReviewAt", "returnedToOriginatorAt", "revisionId", "sequence", "status", "submittedAt", "transmittalId" FROM "ReviewCycle";
DROP TABLE "ReviewCycle";
ALTER TABLE "new_ReviewCycle" RENAME TO "ReviewCycle";
CREATE INDEX "ReviewCycle_status_idx" ON "ReviewCycle"("status");
CREATE INDEX "ReviewCycle_revisionId_idx" ON "ReviewCycle"("revisionId");
CREATE INDEX "ReviewCycle_projectId_idx" ON "ReviewCycle"("projectId");
CREATE TABLE "new_Revision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "series" TEXT NOT NULL DEFAULT 'DESIGN',
    "state" TEXT NOT NULL DEFAULT 'IN_PREPARATION',
    "statusCode" TEXT,
    "phase" TEXT,
    "reasonForRevision" TEXT,
    "changeDescription" TEXT,
    "plannedSubmissionDate" DATETIME,
    "issueDate" DATETIME,
    "nativeFileId" TEXT,
    "renditionFileId" TEXT,
    "appVersion" TEXT,
    "authorizationReason" TEXT,
    "authorizedById" TEXT,
    "authorizedByName" TEXT,
    "authorizedAt" DATETIME,
    "releasedAt" DATETIME,
    "releasedById" TEXT,
    "releasedByName" TEXT,
    "supersededAt" DATETIME,
    "supersededById" TEXT,
    "voidedAt" DATETIME,
    "voidReason" TEXT,
    "voidAuthority" TEXT,
    "voidReassessment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Revision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Revision_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Revision" ("appVersion", "authorizationReason", "authorizedAt", "authorizedById", "authorizedByName", "changeDescription", "createdAt", "documentId", "id", "issueDate", "nativeFileId", "phase", "plannedSubmissionDate", "reasonForRevision", "releasedAt", "releasedById", "releasedByName", "renditionFileId", "series", "state", "statusCode", "supersededAt", "supersededById", "value", "voidAuthority", "voidReason", "voidReassessment", "voidedAt") SELECT "appVersion", "authorizationReason", "authorizedAt", "authorizedById", "authorizedByName", "changeDescription", "createdAt", "documentId", "id", "issueDate", "nativeFileId", "phase", "plannedSubmissionDate", "reasonForRevision", "releasedAt", "releasedById", "releasedByName", "renditionFileId", "series", "state", "statusCode", "supersededAt", "supersededById", "value", "voidAuthority", "voidReason", "voidReassessment", "voidedAt" FROM "Revision";
DROP TABLE "Revision";
ALTER TABLE "new_Revision" RENAME TO "Revision";
CREATE INDEX "Revision_state_idx" ON "Revision"("state");
CREATE INDEX "Revision_projectId_idx" ON "Revision"("projectId");
CREATE UNIQUE INDEX "Revision_projectId_documentId_value_key" ON "Revision"("projectId", "documentId", "value");
CREATE TABLE "new_ScheduleActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "scheduleVersionId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "actionCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baselineDate" DATETIME,
    "forecastDate" DATETIME,
    "responsibleParty" TEXT,
    "actionId" TEXT,
    CONSTRAINT "ScheduleActivity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ScheduleActivity_scheduleVersionId_fkey" FOREIGN KEY ("scheduleVersionId") REFERENCES "ScheduleVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ScheduleActivity_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ScheduleActivity" ("actionCode", "actionId", "baselineDate", "externalId", "forecastDate", "id", "name", "responsibleParty", "scheduleVersionId") SELECT "actionCode", "actionId", "baselineDate", "externalId", "forecastDate", "id", "name", "responsibleParty", "scheduleVersionId" FROM "ScheduleActivity";
DROP TABLE "ScheduleActivity";
ALTER TABLE "new_ScheduleActivity" RENAME TO "ScheduleActivity";
CREATE INDEX "ScheduleActivity_actionCode_idx" ON "ScheduleActivity"("actionCode");
CREATE INDEX "ScheduleActivity_actionId_idx" ON "ScheduleActivity"("actionId");
CREATE INDEX "ScheduleActivity_projectId_idx" ON "ScheduleActivity"("projectId");
CREATE UNIQUE INDEX "ScheduleActivity_projectId_scheduleVersionId_externalId_key" ON "ScheduleActivity"("projectId", "scheduleVersionId", "externalId");
CREATE TABLE "new_ScheduleVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "versionLabel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "importedById" TEXT NOT NULL,
    "importedByName" TEXT NOT NULL,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" DATETIME,
    "publishedByName" TEXT,
    "supersededAt" DATETIME,
    CONSTRAINT "ScheduleVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ScheduleVersion" ("id", "importedAt", "importedById", "importedByName", "notes", "publishedAt", "publishedByName", "sourceName", "status", "supersededAt", "versionLabel") SELECT "id", "importedAt", "importedById", "importedByName", "notes", "publishedAt", "publishedByName", "sourceName", "status", "supersededAt", "versionLabel" FROM "ScheduleVersion";
DROP TABLE "ScheduleVersion";
ALTER TABLE "new_ScheduleVersion" RENAME TO "ScheduleVersion";
CREATE INDEX "ScheduleVersion_status_importedAt_idx" ON "ScheduleVersion"("status", "importedAt");
CREATE INDEX "ScheduleVersion_projectId_idx" ON "ScheduleVersion"("projectId");
CREATE UNIQUE INDEX "ScheduleVersion_projectId_sourceName_versionLabel_key" ON "ScheduleVersion"("projectId", "sourceName", "versionLabel");
CREATE TABLE "new_Scheme" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "delimiter" TEXT NOT NULL DEFAULT '-',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    CONSTRAINT "Scheme_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Scheme" ("active", "delimiter", "id", "name", "notes") SELECT "active", "delimiter", "id", "name", "notes" FROM "Scheme";
DROP TABLE "Scheme";
ALTER TABLE "new_Scheme" RENAME TO "Scheme";
CREATE INDEX "Scheme_orgId_idx" ON "Scheme"("orgId");
CREATE UNIQUE INDEX "Scheme_orgId_name_key" ON "Scheme"("orgId", "name");
CREATE TABLE "new_SchemeRouting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "deliverableType" TEXT NOT NULL,
    "schemeName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    CONSTRAINT "SchemeRouting_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SchemeRouting" ("deliverableType", "id", "schemeName", "status") SELECT "deliverableType", "id", "schemeName", "status" FROM "SchemeRouting";
DROP TABLE "SchemeRouting";
ALTER TABLE "new_SchemeRouting" RENAME TO "SchemeRouting";
CREATE INDEX "SchemeRouting_orgId_idx" ON "SchemeRouting"("orgId");
CREATE UNIQUE INDEX "SchemeRouting_orgId_deliverableType_key" ON "SchemeRouting"("orgId", "deliverableType");
CREATE TABLE "new_ScopeConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
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
    "executionSeriesStart" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ScopeConfig_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ScopeConfig" ("assessmentLevel", "controlFunctionName", "defectAcceptanceRole", "effectiveDate", "executionSeriesStart", "externalInitiation", "id", "integrityThreshold", "measurementIntervalDays", "organizationName", "scopeStatement", "standardVersion", "submitRoles") SELECT "assessmentLevel", "controlFunctionName", "defectAcceptanceRole", "effectiveDate", "executionSeriesStart", "externalInitiation", "id", "integrityThreshold", "measurementIntervalDays", "organizationName", "scopeStatement", "standardVersion", "submitRoles" FROM "ScopeConfig";
DROP TABLE "ScopeConfig";
ALTER TABLE "new_ScopeConfig" RENAME TO "ScopeConfig";
CREATE INDEX "ScopeConfig_projectId_idx" ON "ScopeConfig"("projectId");
CREATE TABLE "new_SpineLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "checkId" TEXT,
    "routeId" TEXT,
    "alignment" TEXT NOT NULL DEFAULT 'ALIGNED',
    "reason" TEXT,
    "owner" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SpineLink_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SpineLink" ("alignment", "checkId", "id", "owner", "reason", "routeId", "ruleId", "updatedAt") SELECT "alignment", "checkId", "id", "owner", "reason", "routeId", "ruleId", "updatedAt" FROM "SpineLink";
DROP TABLE "SpineLink";
ALTER TABLE "new_SpineLink" RENAME TO "SpineLink";
CREATE INDEX "SpineLink_orgId_idx" ON "SpineLink"("orgId");
CREATE UNIQUE INDEX "SpineLink_orgId_ruleId_checkId_key" ON "SpineLink"("orgId", "ruleId", "checkId");
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
    "uploadedById" TEXT,
    "uploadedByName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoredFile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoredFile_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "Revision" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_StoredFile" ("createdAt", "id", "kind", "mime", "name", "path", "revisionId", "sha256", "size", "uploadedById", "uploadedByName") SELECT "createdAt", "id", "kind", "mime", "name", "path", "revisionId", "sha256", "size", "uploadedById", "uploadedByName" FROM "StoredFile";
DROP TABLE "StoredFile";
ALTER TABLE "new_StoredFile" RENAME TO "StoredFile";
CREATE INDEX "StoredFile_projectId_idx" ON "StoredFile"("projectId");
CREATE TABLE "new_Transmittal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "reasonForIssue" TEXT NOT NULL,
    "dateOfIssue" DATETIME NOT NULL,
    "issuingParty" TEXT NOT NULL,
    "responseRequired" BOOLEAN NOT NULL DEFAULT false,
    "responsePeriodDays" INTEGER,
    "responseDueDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "conditionsResult" TEXT,
    "checkedByName" TEXT,
    "acceptanceCheckedAt" DATETIME,
    "rejectionReason" TEXT,
    "receivedDate" DATETIME,
    "receivedByParty" TEXT,
    "acceptanceNotes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Transmittal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Transmittal" ("acceptanceCheckedAt", "acceptanceNotes", "checkedByName", "conditionsResult", "createdAt", "createdById", "createdByName", "dateOfIssue", "direction", "id", "issuingParty", "number", "reasonForIssue", "receivedByParty", "receivedDate", "rejectionReason", "responseDueDate", "responsePeriodDays", "responseRequired", "status") SELECT "acceptanceCheckedAt", "acceptanceNotes", "checkedByName", "conditionsResult", "createdAt", "createdById", "createdByName", "dateOfIssue", "direction", "id", "issuingParty", "number", "reasonForIssue", "receivedByParty", "receivedDate", "rejectionReason", "responseDueDate", "responsePeriodDays", "responseRequired", "status" FROM "Transmittal";
DROP TABLE "Transmittal";
ALTER TABLE "new_Transmittal" RENAME TO "Transmittal";
CREATE INDEX "Transmittal_direction_idx" ON "Transmittal"("direction");
CREATE INDEX "Transmittal_status_idx" ON "Transmittal"("status");
CREATE INDEX "Transmittal_projectId_idx" ON "Transmittal"("projectId");
CREATE UNIQUE INDEX "Transmittal_projectId_number_key" ON "Transmittal"("projectId", "number");
CREATE TABLE "new_TransmittalItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "transmittalId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "markedSuperseded" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "TransmittalItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TransmittalItem_transmittalId_fkey" FOREIGN KEY ("transmittalId") REFERENCES "Transmittal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TransmittalItem_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "Revision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_TransmittalItem" ("id", "markedSuperseded", "revisionId", "transmittalId") SELECT "id", "markedSuperseded", "revisionId", "transmittalId" FROM "TransmittalItem";
DROP TABLE "TransmittalItem";
ALTER TABLE "new_TransmittalItem" RENAME TO "TransmittalItem";
CREATE INDEX "TransmittalItem_transmittalId_idx" ON "TransmittalItem"("transmittalId");
CREATE INDEX "TransmittalItem_revisionId_idx" ON "TransmittalItem"("revisionId");
CREATE INDEX "TransmittalItem_projectId_idx" ON "TransmittalItem"("projectId");
CREATE TABLE "new_TransmittalRecipient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "transmittalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organization" TEXT,
    "userId" TEXT,
    "notifiedAt" DATETIME,
    "openedAt" DATETIME,
    "lastViewedAt" DATETIME,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "acknowledgedAt" DATETIME,
    CONSTRAINT "TransmittalRecipient_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TransmittalRecipient_transmittalId_fkey" FOREIGN KEY ("transmittalId") REFERENCES "Transmittal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_TransmittalRecipient" ("acknowledgedAt", "id", "lastViewedAt", "name", "notifiedAt", "openedAt", "organization", "transmittalId", "userId", "viewCount") SELECT "acknowledgedAt", "id", "lastViewedAt", "name", "notifiedAt", "openedAt", "organization", "transmittalId", "userId", "viewCount" FROM "TransmittalRecipient";
DROP TABLE "TransmittalRecipient";
ALTER TABLE "new_TransmittalRecipient" RENAME TO "TransmittalRecipient";
CREATE INDEX "TransmittalRecipient_transmittalId_idx" ON "TransmittalRecipient"("transmittalId");
CREATE INDEX "TransmittalRecipient_userId_idx" ON "TransmittalRecipient"("userId");
CREATE INDEX "TransmittalRecipient_projectId_idx" ON "TransmittalRecipient"("projectId");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "organization" TEXT,
    "partyId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "User_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("active", "createdAt", "email", "id", "name", "organization", "partyId", "passwordHash", "role") SELECT "active", "createdAt", "email", "id", "name", "organization", "partyId", "passwordHash", "role" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_orgId_idx" ON "User"("orgId");
CREATE TABLE "new_WorkflowRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
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
    CONSTRAINT "WorkflowRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkflowRun_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "Revision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_WorkflowRun" ("createdAt", "currentStep", "id", "revisionId", "startedById", "startedByName", "status", "steps", "templateId", "templateName", "updatedAt") SELECT "createdAt", "currentStep", "id", "revisionId", "startedById", "startedByName", "status", "steps", "templateId", "templateName", "updatedAt" FROM "WorkflowRun";
DROP TABLE "WorkflowRun";
ALTER TABLE "new_WorkflowRun" RENAME TO "WorkflowRun";
CREATE INDEX "WorkflowRun_revisionId_idx" ON "WorkflowRun"("revisionId");
CREATE INDEX "WorkflowRun_status_idx" ON "WorkflowRun"("status");
CREATE INDEX "WorkflowRun_projectId_idx" ON "WorkflowRun"("projectId");
CREATE TABLE "new_WorkflowTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "classes" TEXT NOT NULL DEFAULT '*',
    "steps" TEXT NOT NULL,
    "outcomeSetKey" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkflowTemplate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_WorkflowTemplate" ("active", "classes", "createdAt", "createdByName", "description", "id", "isDefault", "name", "outcomeSetKey", "steps") SELECT "active", "classes", "createdAt", "createdByName", "description", "id", "isDefault", "name", "outcomeSetKey", "steps" FROM "WorkflowTemplate";
DROP TABLE "WorkflowTemplate";
ALTER TABLE "new_WorkflowTemplate" RENAME TO "WorkflowTemplate";
CREATE INDEX "WorkflowTemplate_orgId_idx" ON "WorkflowTemplate"("orgId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Project_orgId_idx" ON "Project"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_orgId_code_key" ON "Project"("orgId", "code");

-- CreateIndex
CREATE INDEX "ProjectMembership_userId_idx" ON "ProjectMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMembership_projectId_userId_key" ON "ProjectMembership"("projectId", "userId");

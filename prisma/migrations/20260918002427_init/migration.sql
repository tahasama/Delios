-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "organization" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Delegation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "scope" TEXT,
    "endDate" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Delegation_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Delegation_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuthorityRow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "version" INTEGER NOT NULL,
    "discipline" TEXT,
    "docType" TEXT,
    "criticality" TEXT,
    "minRole" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ConfigSet" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1
);

-- CreateTable
CREATE TABLE "ConfigValue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "setKey" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "props" TEXT,
    CONSTRAINT "ConfigValue_setKey_fkey" FOREIGN KEY ("setKey") REFERENCES "ConfigSet" ("key") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Scheme" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "delimiter" TEXT NOT NULL DEFAULT '-',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT
);

-- CreateTable
CREATE TABLE "SchemeField" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "schemeId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "valueSetKey" TEXT,
    "rule" TEXT,
    CONSTRAINT "SchemeField_schemeId_fkey" FOREIGN KEY ("schemeId") REFERENCES "Scheme" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SchemeRouting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deliverableType" TEXT NOT NULL,
    "schemeName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE'
);

-- CreateTable
CREATE TABLE "NumberCounter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "prefix" TEXT NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1
);

-- CreateTable
CREATE TABLE "Document" (
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

-- CreateTable
CREATE TABLE "Revision" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    CONSTRAINT "Revision_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "revisionId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "approverName" TEXT NOT NULL,
    "approverRole" TEXT NOT NULL,
    "matrixVersion" INTEGER NOT NULL,
    "decidedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    CONSTRAINT "Approval_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "Revision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Approval_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReviewCycle" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "outcomeAt" DATETIME,
    "outcomeByName" TEXT,
    "outcomeNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewCycle_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "Revision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReviewCycle_transmittalId_fkey" FOREIGN KEY ("transmittalId") REFERENCES "Transmittal" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReviewAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cycleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 1,
    "completedAt" DATETIME,
    CONSTRAINT "ReviewAssignment_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "ReviewCycle" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReviewComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cycleId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "progressionPreventing" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "closedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewComment_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "ReviewCycle" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Transmittal" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "TransmittalItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transmittalId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "markedSuperseded" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "TransmittalItem_transmittalId_fkey" FOREIGN KEY ("transmittalId") REFERENCES "Transmittal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TransmittalItem_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "Revision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TransmittalRecipient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transmittalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organization" TEXT,
    "userId" TEXT,
    "acknowledgedAt" DATETIME,
    CONSTRAINT "TransmittalRecipient_transmittalId_fkey" FOREIGN KEY ("transmittalId") REFERENCES "Transmittal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RegisteredCopy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "revisionId" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "actionRecord" TEXT,
    "actionDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RegisteredCopy_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "Revision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Action" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scheduledDate" DATETIME,
    "ownerName" TEXT,
    "scheduleRef" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "BaselineEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actionId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "requiredStatus" TEXT NOT NULL,
    "requiredBy" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByName" TEXT,
    CONSTRAINT "BaselineEntry_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BaselineEntry_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Package" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PackageMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packageId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "requiredStatus" TEXT NOT NULL,
    "completionDate" DATETIME,
    CONSTRAINT "PackageMember_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PackageMember_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Relationship" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "fromType" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toType" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AssetItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "area" TEXT,
    "system" TEXT,
    "unit" TEXT
);

-- CreateTable
CREATE TABLE "StoredFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    CONSTRAINT "StoredFile_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "Revision" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "detail" TEXT
);

-- CreateTable
CREATE TABLE "Defect" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    CONSTRAINT "Defect_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CheckRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "durationMs" INTEGER
);

-- CreateTable
CREATE TABLE "CheckRunItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "failingCount" INTEGER NOT NULL DEFAULT 0,
    "ms" INTEGER,
    CONSTRAINT "CheckRunItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CheckRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ObsolescenceRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "documentId" TEXT,
    "revisionId" TEXT,
    "reason" TEXT NOT NULL,
    "authorityName" TEXT NOT NULL,
    "effectiveDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ExceptionEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "item" TEXT NOT NULL,
    "clauses" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "authority" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "reviewPoint" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ScopeConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationName" TEXT NOT NULL,
    "scopeStatement" TEXT NOT NULL,
    "assessmentLevel" TEXT NOT NULL,
    "standardVersion" TEXT NOT NULL,
    "effectiveDate" DATETIME NOT NULL,
    "integrityThreshold" REAL NOT NULL DEFAULT 95,
    "measurementIntervalDays" INTEGER NOT NULL DEFAULT 30,
    "controlFunctionName" TEXT NOT NULL DEFAULT 'Document Control'
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "ConfigValue_setKey_idx" ON "ConfigValue"("setKey");

-- CreateIndex
CREATE UNIQUE INDEX "ConfigValue_setKey_code_key" ON "ConfigValue"("setKey", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Scheme_name_key" ON "Scheme"("name");

-- CreateIndex
CREATE UNIQUE INDEX "SchemeField_schemeId_position_key" ON "SchemeField"("schemeId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "SchemeRouting_deliverableType_key" ON "SchemeRouting"("deliverableType");

-- CreateIndex
CREATE UNIQUE INDEX "NumberCounter_prefix_key" ON "NumberCounter"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "Document_docNumber_key" ON "Document"("docNumber");

-- CreateIndex
CREATE INDEX "Document_state_idx" ON "Document"("state");

-- CreateIndex
CREATE INDEX "Document_discipline_idx" ON "Document"("discipline");

-- CreateIndex
CREATE INDEX "Document_docType_idx" ON "Document"("docType");

-- CreateIndex
CREATE INDEX "Revision_state_idx" ON "Revision"("state");

-- CreateIndex
CREATE UNIQUE INDEX "Revision_documentId_value_key" ON "Revision"("documentId", "value");

-- CreateIndex
CREATE INDEX "Approval_revisionId_idx" ON "Approval"("revisionId");

-- CreateIndex
CREATE INDEX "ReviewCycle_status_idx" ON "ReviewCycle"("status");

-- CreateIndex
CREATE INDEX "ReviewCycle_revisionId_idx" ON "ReviewCycle"("revisionId");

-- CreateIndex
CREATE INDEX "ReviewComment_cycleId_idx" ON "ReviewComment"("cycleId");

-- CreateIndex
CREATE INDEX "ReviewComment_status_idx" ON "ReviewComment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Transmittal_number_key" ON "Transmittal"("number");

-- CreateIndex
CREATE INDEX "Transmittal_direction_idx" ON "Transmittal"("direction");

-- CreateIndex
CREATE INDEX "Transmittal_status_idx" ON "Transmittal"("status");

-- CreateIndex
CREATE INDEX "TransmittalItem_transmittalId_idx" ON "TransmittalItem"("transmittalId");

-- CreateIndex
CREATE INDEX "TransmittalItem_revisionId_idx" ON "TransmittalItem"("revisionId");

-- CreateIndex
CREATE INDEX "TransmittalRecipient_transmittalId_idx" ON "TransmittalRecipient"("transmittalId");

-- CreateIndex
CREATE INDEX "RegisteredCopy_revisionId_idx" ON "RegisteredCopy"("revisionId");

-- CreateIndex
CREATE UNIQUE INDEX "Action_code_key" ON "Action"("code");

-- CreateIndex
CREATE INDEX "BaselineEntry_documentId_idx" ON "BaselineEntry"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "BaselineEntry_actionId_documentId_key" ON "BaselineEntry"("actionId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "Package_identifier_key" ON "Package"("identifier");

-- CreateIndex
CREATE INDEX "Package_type_idx" ON "Package"("type");

-- CreateIndex
CREATE INDEX "PackageMember_documentId_idx" ON "PackageMember"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "PackageMember_packageId_documentId_key" ON "PackageMember"("packageId", "documentId");

-- CreateIndex
CREATE INDEX "Relationship_kind_toId_idx" ON "Relationship"("kind", "toId");

-- CreateIndex
CREATE INDEX "Relationship_fromId_idx" ON "Relationship"("fromId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetItem_code_key" ON "AssetItem"("code");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_ts_idx" ON "AuditEvent"("ts");

-- CreateIndex
CREATE INDEX "Defect_status_idx" ON "Defect"("status");

-- CreateIndex
CREATE INDEX "Defect_documentId_idx" ON "Defect"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "Defect_checkId_entityKey_key" ON "Defect"("checkId", "entityKey");

-- CreateIndex
CREATE INDEX "CheckRunItem_runId_idx" ON "CheckRunItem"("runId");

-- CreateIndex
CREATE INDEX "Notification_userId_read_idx" ON "Notification"("userId", "read");

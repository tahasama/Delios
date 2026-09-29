-- A delegation says what is handed over, and whether Document Control has
-- carried it out yet. Existing rows are grants already in force.
ALTER TABLE "Delegation" ADD COLUMN "verb" TEXT NOT NULL DEFAULT 'REVIEW';
ALTER TABLE "Delegation" ADD COLUMN "cycleId" TEXT REFERENCES "ReviewCycle"("id");
ALTER TABLE "Delegation" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "Delegation" ADD COLUMN "reason" TEXT;
ALTER TABLE "Delegation" ADD COLUMN "askedById" TEXT;
ALTER TABLE "Delegation" ADD COLUMN "askedByName" TEXT;
ALTER TABLE "Delegation" ADD COLUMN "grantedById" TEXT;
ALTER TABLE "Delegation" ADD COLUMN "grantedByName" TEXT;
ALTER TABLE "Delegation" ADD COLUMN "grantedAt" DATETIME;
ALTER TABLE "Delegation" ADD COLUMN "refusedReason" TEXT;
CREATE INDEX "Delegation_toUserId_status_idx" ON "Delegation"("toUserId", "status");
CREATE INDEX "Delegation_cycleId_idx" ON "Delegation"("cycleId");

-- Who may read a document that is not open to the project, named one by one by
-- the author or the uploader.
CREATE TABLE "DocumentAccess" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "addedByName" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentAccess_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DocumentAccess_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DocumentAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DocumentAccess_documentId_userId_key" ON "DocumentAccess"("documentId", "userId");
CREATE INDEX "DocumentAccess_projectId_idx" ON "DocumentAccess"("projectId");
CREATE INDEX "DocumentAccess_userId_idx" ON "DocumentAccess"("userId");

-- Which acts Document Control carries out, and which the people doing the work
-- carry out themselves. A row exists only where an administrator overrode what
-- the project itself says.
CREATE TABLE "ControlSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'FOLLOW',
    "setById" TEXT,
    "setByName" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ControlSetting_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ControlSetting_projectId_key_key" ON "ControlSetting"("projectId", "key");
CREATE INDEX "ControlSetting_projectId_idx" ON "ControlSetting"("projectId");

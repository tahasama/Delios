-- CreateTable
CREATE TABLE "ControlledSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL DEFAULT 'default',
    "title" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ControlledSet_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ControlledSet_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ControlledVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "setId" TEXT NOT NULL,
    "versionLabel" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'DRAFT',
    "payload" TEXT NOT NULL,
    "diff" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "sourceName" TEXT,
    "sourceSize" INTEGER,
    "sourceHash" TEXT,
    "notes" TEXT,
    "submittedById" TEXT,
    "submittedByName" TEXT,
    "submittedAt" DATETIME,
    "decidedById" TEXT,
    "decidedByName" TEXT,
    "decidedAt" DATETIME,
    "decisionReason" TEXT,
    "appliedAt" DATETIME,
    "supersededAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ControlledVersion_setId_fkey" FOREIGN KEY ("setId") REFERENCES "ControlledSet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ControlledSet_orgId_idx" ON "ControlledSet"("orgId");

-- CreateIndex
CREATE INDEX "ControlledSet_projectId_idx" ON "ControlledSet"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ControlledSet_orgId_projectId_kind_key_key" ON "ControlledSet"("orgId", "projectId", "kind", "key");

-- CreateIndex
CREATE INDEX "ControlledVersion_setId_state_idx" ON "ControlledVersion"("setId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "ControlledVersion_setId_versionLabel_key" ON "ControlledVersion"("setId", "versionLabel");


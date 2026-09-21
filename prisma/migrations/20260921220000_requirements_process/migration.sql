-- AlterTable
ALTER TABLE "ProjectMembership" ADD COLUMN "department" TEXT;

-- CreateTable
CREATE TABLE "RequirementCall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "actionCodes" TEXT NOT NULL,
    "dueAt" DATETIME NOT NULL,
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT NOT NULL,
    "issuedByName" TEXT NOT NULL,
    "reminders" INTEGER NOT NULL DEFAULT 0,
    "lastRemindedAt" DATETIME,
    "answeredAt" DATETIME,
    "answerNote" TEXT,
    CONSTRAINT "RequirementCall_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SenderIssue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "entryCount" INTEGER NOT NULL,
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT NOT NULL,
    "issuedByName" TEXT NOT NULL,
    CONSTRAINT "SenderIssue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReadinessConfirmation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "available" BOOLEAN NOT NULL,
    "note" TEXT,
    "confirmedById" TEXT NOT NULL,
    "confirmedByName" TEXT NOT NULL,
    "confirmedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReadinessConfirmation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReadinessConfirmation_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BaselineEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "requiredStatus" TEXT NOT NULL,
    "requiredBy" DATETIME NOT NULL,
    "department" TEXT,
    "submittedBy" TEXT,
    "approvedBy" TEXT,
    "leadBusinessDays" INTEGER,
    "manualDate" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByName" TEXT,
    CONSTRAINT "BaselineEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BaselineEntry_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BaselineEntry_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_BaselineEntry" ("actionId", "approvedBy", "createdAt", "createdByName", "department", "documentId", "id", "leadBusinessDays", "manualDate", "projectId", "requiredBy", "requiredStatus", "submittedBy") SELECT "actionId", "approvedBy", "createdAt", "createdByName", "department", "documentId", "id", "leadBusinessDays", "manualDate", "projectId", "requiredBy", "requiredStatus", "submittedBy" FROM "BaselineEntry";
DROP TABLE "BaselineEntry";
ALTER TABLE "new_BaselineEntry" RENAME TO "BaselineEntry";
CREATE INDEX "BaselineEntry_documentId_idx" ON "BaselineEntry"("documentId");
CREATE INDEX "BaselineEntry_projectId_idx" ON "BaselineEntry"("projectId");
CREATE UNIQUE INDEX "BaselineEntry_projectId_actionId_documentId_key" ON "BaselineEntry"("projectId", "actionId", "documentId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "RequirementCall_projectId_department_idx" ON "RequirementCall"("projectId", "department");

-- CreateIndex
CREATE INDEX "SenderIssue_projectId_sender_idx" ON "SenderIssue"("projectId", "sender");

-- CreateIndex
CREATE INDEX "ReadinessConfirmation_projectId_idx" ON "ReadinessConfirmation"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ReadinessConfirmation_actionId_department_key" ON "ReadinessConfirmation"("actionId", "department");


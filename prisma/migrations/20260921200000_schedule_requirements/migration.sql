-- AlterTable
ALTER TABLE "Action" ADD COLUMN "departments" TEXT;

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
    "createdByName" TEXT,
    CONSTRAINT "BaselineEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BaselineEntry_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BaselineEntry_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_BaselineEntry" ("actionId", "createdAt", "createdByName", "documentId", "id", "projectId", "requiredBy", "requiredStatus") SELECT "actionId", "createdAt", "createdByName", "documentId", "id", "projectId", "requiredBy", "requiredStatus" FROM "BaselineEntry";
DROP TABLE "BaselineEntry";
ALTER TABLE "new_BaselineEntry" RENAME TO "BaselineEntry";
CREATE INDEX "BaselineEntry_documentId_idx" ON "BaselineEntry"("documentId");
CREATE INDEX "BaselineEntry_projectId_idx" ON "BaselineEntry"("projectId");
CREATE UNIQUE INDEX "BaselineEntry_projectId_actionId_documentId_key" ON "BaselineEntry"("projectId", "actionId", "documentId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;


-- Requirements that existed before the needed-by rule keep the date they were given.
UPDATE "BaselineEntry" SET "manualDate" = true;

-- AlterTable
ALTER TABLE "ScopeConfig" ADD COLUMN "dmpDocumentId" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ConfigValue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "setKey" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "props" TEXT,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConfigValue_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ConfigValue_orgId_setKey_fkey" FOREIGN KEY ("orgId", "setKey") REFERENCES "ConfigSet" ("orgId", "key") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ConfigValue" ("code", "id", "label", "orgId", "props", "setKey", "sort", "status") SELECT "code", "id", "label", "orgId", "props", "setKey", "sort", "status" FROM "ConfigValue";
DROP TABLE "ConfigValue";
ALTER TABLE "new_ConfigValue" RENAME TO "ConfigValue";
CREATE INDEX "ConfigValue_orgId_setKey_idx" ON "ConfigValue"("orgId", "setKey");
CREATE UNIQUE INDEX "ConfigValue_orgId_setKey_code_key" ON "ConfigValue"("orgId", "setKey", "code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;


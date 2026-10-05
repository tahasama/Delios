/*
  Warnings:

  - You are about to drop the column `serves` on the `ConfigSet` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ConfigSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "group" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "ConfigSet_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ConfigSet" ("description", "group", "id", "key", "orgId", "title", "version") SELECT "description", "group", "id", "key", "orgId", "title", "version" FROM "ConfigSet";
DROP TABLE "ConfigSet";
ALTER TABLE "new_ConfigSet" RENAME TO "ConfigSet";
CREATE INDEX "ConfigSet_orgId_idx" ON "ConfigSet"("orgId");
CREATE UNIQUE INDEX "ConfigSet_orgId_key_key" ON "ConfigSet"("orgId", "key");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

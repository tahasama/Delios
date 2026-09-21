-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Party" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Party_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Party" ("code", "id", "isInternal", "name", "orgId") SELECT "code", "id", "isInternal", "name", "orgId" FROM "Party";
DROP TABLE "Party";
ALTER TABLE "new_Party" RENAME TO "Party";
CREATE INDEX "Party_orgId_idx" ON "Party"("orgId");
CREATE UNIQUE INDEX "Party_orgId_code_key" ON "Party"("orgId", "code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;


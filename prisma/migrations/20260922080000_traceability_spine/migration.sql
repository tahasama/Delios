-- The pre-v2 spine held one row per check with combined clause strings; it is
-- rebuilt per relationship from the reference Standard after this migration.
DELETE FROM "SpineLink";

-- CreateTable
CREATE TABLE "SpineBaseline" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "standardVersion" TEXT NOT NULL,
    "links" INTEGER NOT NULL,
    "aligned" INTEGER NOT NULL,
    "notApplicable" INTEGER NOT NULL,
    "withdrawn" INTEGER NOT NULL,
    "unresolved" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "releasedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedById" TEXT NOT NULL,
    "releasedByName" TEXT NOT NULL,
    CONSTRAINT "SpineBaseline_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SpineLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "alignment" TEXT NOT NULL DEFAULT 'ALIGNED',
    "reason" TEXT,
    "owner" TEXT,
    "ruleVersion" TEXT,
    "targetVersion" TEXT,
    "reviewedAt" DATETIME,
    "reviewedByName" TEXT,
    "changeRef" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SpineLink_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SpineLink" ("alignment", "id", "orgId", "owner", "reason", "ruleId", "updatedAt") SELECT "alignment", "id", "orgId", "owner", "reason", "ruleId", "updatedAt" FROM "SpineLink";
DROP TABLE "SpineLink";
ALTER TABLE "new_SpineLink" RENAME TO "SpineLink";
CREATE INDEX "SpineLink_orgId_idx" ON "SpineLink"("orgId");
CREATE UNIQUE INDEX "SpineLink_orgId_ruleId_kind_target_key" ON "SpineLink"("orgId", "ruleId", "kind", "target");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "SpineBaseline_orgId_idx" ON "SpineBaseline"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "SpineBaseline_orgId_label_key" ON "SpineBaseline"("orgId", "label");


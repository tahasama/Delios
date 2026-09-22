-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
INSERT INTO "new_ObsolescenceRecord" ("authorityName", "createdAt", "createdById", "documentId", "effectiveDate", "id", "kind", "projectId", "reason", "revisionId") SELECT "authorityName", "createdAt", "createdById", "documentId", "effectiveDate", "id", "kind", "projectId", "reason", "revisionId" FROM "ObsolescenceRecord";
DROP TABLE "ObsolescenceRecord";
ALTER TABLE "new_ObsolescenceRecord" RENAME TO "ObsolescenceRecord";
CREATE INDEX "ObsolescenceRecord_projectId_idx" ON "ObsolescenceRecord"("projectId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;


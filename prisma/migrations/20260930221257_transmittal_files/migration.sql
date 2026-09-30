-- A file that came with a transmittal is kept with it, as the record of what
-- arrived. It is not a register document unless somebody makes it one.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_StoredFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mime" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "revisionId" TEXT,
    "cycleId" TEXT,
    "uploadedById" TEXT,
    "uploadedByName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "transmittalId" TEXT,
    CONSTRAINT "StoredFile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoredFile_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "Revision" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StoredFile_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "ReviewCycle" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StoredFile_transmittalId_fkey" FOREIGN KEY ("transmittalId") REFERENCES "Transmittal" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_StoredFile" ("createdAt", "cycleId", "id", "kind", "mime", "name", "path", "projectId", "revisionId", "sha256", "size", "uploadedById", "uploadedByName") SELECT "createdAt", "cycleId", "id", "kind", "mime", "name", "path", "projectId", "revisionId", "sha256", "size", "uploadedById", "uploadedByName" FROM "StoredFile";
DROP TABLE "StoredFile";
ALTER TABLE "new_StoredFile" RENAME TO "StoredFile";
CREATE INDEX "StoredFile_projectId_idx" ON "StoredFile"("projectId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

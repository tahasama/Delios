-- AlterTable
ALTER TABLE "Revision" ADD COLUMN "submittedAt" DATETIME;
ALTER TABLE "Revision" ADD COLUMN "submittedById" TEXT;
ALTER TABLE "Revision" ADD COLUMN "submittedByName" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Package" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'DELIVERY',
    "partyCode" TEXT,
    "purpose" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "membershipRule" TEXT,
    "recipientName" TEXT NOT NULL,
    "completionDate" DATETIME NOT NULL,
    "requiredStatus" TEXT NOT NULL,
    "compositionOwnerId" TEXT NOT NULL,
    "compositionOwnerName" TEXT NOT NULL,
    "acceptanceAuthorityId" TEXT NOT NULL,
    "acceptanceAuthorityName" TEXT NOT NULL,
    "closedAt" DATETIME,
    "closureNote" TEXT,
    "ruleCeasedAt" DATETIME,
    "assessedAt" DATETIME,
    "shortfall" TEXT,
    "shortfallIssuedAt" DATETIME,
    "shortfallAcceptedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Package_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Package" ("acceptanceAuthorityId", "acceptanceAuthorityName", "assessedAt", "closedAt", "closureNote", "completionDate", "compositionOwnerId", "compositionOwnerName", "createdAt", "id", "identifier", "membershipRule", "projectId", "purpose", "recipientName", "requiredStatus", "ruleCeasedAt", "shortfall", "shortfallAcceptedBy", "shortfallIssuedAt", "type") SELECT "acceptanceAuthorityId", "acceptanceAuthorityName", "assessedAt", "closedAt", "closureNote", "completionDate", "compositionOwnerId", "compositionOwnerName", "createdAt", "id", "identifier", "membershipRule", "projectId", "purpose", "recipientName", "requiredStatus", "ruleCeasedAt", "shortfall", "shortfallAcceptedBy", "shortfallIssuedAt", "type" FROM "Package";
DROP TABLE "Package";
ALTER TABLE "new_Package" RENAME TO "Package";
CREATE INDEX "Package_type_idx" ON "Package"("type");
CREATE INDEX "Package_projectId_idx" ON "Package"("projectId");
CREATE UNIQUE INDEX "Package_projectId_identifier_key" ON "Package"("projectId", "identifier");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;


-- An organization with no accounts here receives a transmittal through one of
-- our people, who records that it went and keeps the proof.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TransmittalRecipient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "transmittalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'TO',
    "organization" TEXT,
    "userId" TEXT,
    "notifiedAt" DATETIME,
    "openedAt" DATETIME,
    "lastViewedAt" DATETIME,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "acknowledgedAt" DATETIME,
    "partyId" TEXT,
    "dispatchedAt" DATETIME,
    "dispatchChannel" TEXT,
    "dispatchRef" TEXT,
    "dispatchedByName" TEXT,
    "proofFileId" TEXT,
    CONSTRAINT "TransmittalRecipient_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TransmittalRecipient_transmittalId_fkey" FOREIGN KEY ("transmittalId") REFERENCES "Transmittal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TransmittalRecipient_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TransmittalRecipient_proofFileId_fkey" FOREIGN KEY ("proofFileId") REFERENCES "StoredFile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TransmittalRecipient" ("acknowledgedAt", "id", "kind", "lastViewedAt", "name", "notifiedAt", "openedAt", "organization", "projectId", "transmittalId", "userId", "viewCount") SELECT "acknowledgedAt", "id", "kind", "lastViewedAt", "name", "notifiedAt", "openedAt", "organization", "projectId", "transmittalId", "userId", "viewCount" FROM "TransmittalRecipient";
DROP TABLE "TransmittalRecipient";
ALTER TABLE "new_TransmittalRecipient" RENAME TO "TransmittalRecipient";
CREATE INDEX "TransmittalRecipient_transmittalId_idx" ON "TransmittalRecipient"("transmittalId");
CREATE INDEX "TransmittalRecipient_userId_idx" ON "TransmittalRecipient"("userId");
CREATE INDEX "TransmittalRecipient_projectId_idx" ON "TransmittalRecipient"("projectId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

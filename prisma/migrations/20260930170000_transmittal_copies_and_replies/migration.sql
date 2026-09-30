-- To and copied-to, and the answer.
--
-- A transmittal asks named people to do something and keeps others informed.
-- Until now both were the same row, so "seen" turned green because somebody
-- copied in happened to look. Everyone already recorded was asked, so they
-- are all TO.
ALTER TABLE "TransmittalRecipient" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'TO';

-- What came back. Correspondence, not a state: several people may answer, and
-- what they wrote stands as they wrote it.
CREATE TABLE "TransmittalReply" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "transmittalId" TEXT NOT NULL,
    "byUserId" TEXT,
    "byName" TEXT NOT NULL,
    "byOrganization" TEXT,
    "note" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TransmittalReply_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TransmittalReply_transmittalId_fkey" FOREIGN KEY ("transmittalId") REFERENCES "Transmittal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TransmittalReply_transmittalId_idx" ON "TransmittalReply"("transmittalId");
CREATE INDEX "TransmittalReply_projectId_idx" ON "TransmittalReply"("projectId");

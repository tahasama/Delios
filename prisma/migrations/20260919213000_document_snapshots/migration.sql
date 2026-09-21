-- CreateTable
CREATE TABLE "DocumentSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "revisionId" TEXT,
    "auditEventId" TEXT,
    "eventType" TEXT NOT NULL,
    "eventLabel" TEXT,
    "actorName" TEXT NOT NULL,
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" TEXT NOT NULL,
    CONSTRAINT "DocumentSnapshot_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "DocumentSnapshot_documentId_capturedAt_idx" ON "DocumentSnapshot"("documentId", "capturedAt");

-- CreateIndex
CREATE INDEX "DocumentSnapshot_revisionId_idx" ON "DocumentSnapshot"("revisionId");

-- CreateIndex
CREATE INDEX "DocumentSnapshot_auditEventId_idx" ON "DocumentSnapshot"("auditEventId");

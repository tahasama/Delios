-- The dispatch log narrows and orders by these columns, so it can no longer
-- read every transmittal into memory to show fifty of them.
CREATE INDEX "Transmittal_projectId_dateOfIssue_idx" ON "Transmittal"("projectId", "dateOfIssue");
CREATE INDEX "Transmittal_projectId_createdAt_idx" ON "Transmittal"("projectId", "createdAt");
CREATE INDEX "Transmittal_reasonForIssue_idx" ON "Transmittal"("reasonForIssue");
CREATE INDEX "Transmittal_issuingParty_idx" ON "Transmittal"("issuingParty");
CREATE INDEX "Transmittal_responseDueDate_idx" ON "Transmittal"("responseDueDate");
CREATE INDEX "Transmittal_receivedDate_idx" ON "Transmittal"("receivedDate");

-- The reviews page reads newest first, narrowed by status, and pages through
-- the result rather than loading five hundred rows to show fifty.
CREATE INDEX "ReviewCycle_projectId_submittedAt_idx" ON "ReviewCycle"("projectId", "submittedAt");
CREATE INDEX "ReviewCycle_status_submittedAt_idx" ON "ReviewCycle"("status", "submittedAt");

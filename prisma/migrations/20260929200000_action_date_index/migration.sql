-- The plan reads actions by date, inside a window, and pages through them.
CREATE INDEX "Action_projectId_scheduledDate_idx" ON "Action"("projectId", "scheduledDate");

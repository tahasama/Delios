-- CreateTable
CREATE TABLE "ScheduleVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceName" TEXT NOT NULL,
    "versionLabel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "importedById" TEXT NOT NULL,
    "importedByName" TEXT NOT NULL,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" DATETIME,
    "publishedByName" TEXT,
    "supersededAt" DATETIME
);

-- CreateTable
CREATE TABLE "ScheduleActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scheduleVersionId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "actionCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baselineDate" DATETIME,
    "forecastDate" DATETIME,
    "responsibleParty" TEXT,
    "actionId" TEXT,
    CONSTRAINT "ScheduleActivity_scheduleVersionId_fkey" FOREIGN KEY ("scheduleVersionId") REFERENCES "ScheduleVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ScheduleActivity_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleVersion_sourceName_versionLabel_key" ON "ScheduleVersion"("sourceName", "versionLabel");

-- CreateIndex
CREATE INDEX "ScheduleVersion_status_importedAt_idx" ON "ScheduleVersion"("status", "importedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleActivity_scheduleVersionId_externalId_key" ON "ScheduleActivity"("scheduleVersionId", "externalId");

-- CreateIndex
CREATE INDEX "ScheduleActivity_actionCode_idx" ON "ScheduleActivity"("actionCode");

-- CreateIndex
CREATE INDEX "ScheduleActivity_actionId_idx" ON "ScheduleActivity"("actionId");

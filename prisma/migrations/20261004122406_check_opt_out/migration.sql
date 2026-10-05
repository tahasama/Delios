-- CreateTable
CREATE TABLE "CheckOptOut" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "setById" TEXT,
    "setByName" TEXT NOT NULL,
    "setAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CheckOptOut_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CheckOptOut_projectId_idx" ON "CheckOptOut"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckOptOut_projectId_checkId_key" ON "CheckOptOut"("projectId", "checkId");

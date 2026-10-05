-- CreateTable
CREATE TABLE "LocalCheck" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "addedById" TEXT,
    "addedByName" TEXT NOT NULL,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LocalCheck_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "LocalCheck_projectId_idx" ON "LocalCheck"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "LocalCheck_projectId_code_key" ON "LocalCheck"("projectId", "code");

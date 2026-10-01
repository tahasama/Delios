-- What an organization calls each revision state on screen. The states and
-- what they do are fixed; only the names are the organization's.
CREATE TABLE "StateName" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "setById" TEXT,
    "setByName" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StateName_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "StateName_orgId_idx" ON "StateName"("orgId");
CREATE UNIQUE INDEX "StateName_orgId_code_key" ON "StateName"("orgId", "code");

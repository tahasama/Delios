-- Fields an organization adds for itself, and the answers given to them.
ALTER TABLE "FieldPolicy" ADD COLUMN "label" TEXT;
ALTER TABLE "Document" ADD COLUMN "extras" TEXT;
CREATE TABLE "CustomField" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orgId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "control" TEXT NOT NULL,
  "setKey" TEXT,
  "rule" TEXT NOT NULL DEFAULT OPTIONAL,
  "help" TEXT,
  "position" INTEGER NOT NULL DEFAULT 0,
  "inRegister" BOOLEAN NOT NULL DEFAULT false,
  "addedByName" TEXT NOT NULL,
  "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomField_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CustomField_orgId_kind_key_key" ON "CustomField"("orgId", "kind", "key");
CREATE INDEX "CustomField_orgId_idx" ON "CustomField"("orgId");

-- Which fields a form asks for, and which it insists on.
CREATE TABLE "FieldPolicy" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orgId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "field" TEXT NOT NULL,
  "rule" TEXT NOT NULL,
  "setByName" TEXT NOT NULL,
  "setAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FieldPolicy_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FieldPolicy_orgId_kind_field_key" ON "FieldPolicy"("orgId", "kind", "field");
CREATE INDEX "FieldPolicy_orgId_idx" ON "FieldPolicy"("orgId");

-- Phase 2 — functions and the permission matrix.
--
-- Existing memberships carry a role name. This migration publishes that same
-- vocabulary as a Function catalogue per organization, re-points every
-- membership at its function, and gives each function a starting rule so
-- behaviour is unchanged on the first request after deploying.

-- CreateTable
CREATE TABLE "Function" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "clearance" INTEGER NOT NULL DEFAULT 1,
    "legacyRole" TEXT NOT NULL DEFAULT 'AUTHOR',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Function_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PermissionRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "functionId" TEXT NOT NULL,
    "deliverableType" TEXT,
    "docType" TEXT,
    "discipline" TEXT,
    "criticality" TEXT,
    "confidentiality" TEXT,
    "verbs" TEXT NOT NULL,
    "note" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PermissionRule_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PermissionRule_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "Function" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Function_orgId_idx" ON "Function"("orgId");
CREATE UNIQUE INDEX "Function_orgId_code_key" ON "Function"("orgId", "code");
CREATE INDEX "PermissionRule_orgId_idx" ON "PermissionRule"("orgId");
CREATE INDEX "PermissionRule_functionId_idx" ON "PermissionRule"("functionId");

-- Publish the starting function catalogue for every existing organization.
INSERT INTO "Function" ("id", "orgId", "code", "name", "description", "clearance", "legacyRole", "sort")
SELECT 'fn-' || o."id" || '-ADMIN', o."id", 'ADMIN', 'Administrator',
       'Publishes configuration, people and the permission matrix.', 4, 'ADMIN', 0 FROM "Organization" o
UNION ALL SELECT 'fn-' || o."id" || '-CONTROLLER', o."id", 'CONTROLLER', 'Document Control',
       'The designated control function: numbers, custody, releases, transmittals, obsolescence.', 4, 'CONTROLLER', 1 FROM "Organization" o
UNION ALL SELECT 'fn-' || o."id" || '-APPROVER', o."id", 'APPROVER', 'Approver',
       'Records approval decisions within their authority.', 3, 'APPROVER', 2 FROM "Organization" o
UNION ALL SELECT 'fn-' || o."id" || '-REVIEWER', o."id", 'REVIEWER', 'Reviewer',
       'Performs assigned reviews and records comments.', 2, 'REVIEWER', 3 FROM "Organization" o
UNION ALL SELECT 'fn-' || o."id" || '-AUTHOR', o."id", 'AUTHOR', 'Author / Originator',
       'Creates documents and revisions and submits them.', 2, 'AUTHOR', 4 FROM "Organization" o
UNION ALL SELECT 'fn-' || o."id" || '-VIEWER', o."id", 'VIEWER', 'Viewer',
       'Reads released, current information.', 1, 'VIEWER', 5 FROM "Organization" o;

-- One opening rule per function, across all classes. Narrowing it by
-- discipline or criticality is the organization's job, in Admin.
INSERT INTO "PermissionRule" ("id", "orgId", "functionId", "verbs", "note", "sort", "updatedAt")
SELECT 'pr-' || f."id", f."orgId", f."id",
  CASE f."legacyRole"
    WHEN 'ADMIN'      THEN '["READ","CREATE","REVISE","REVIEW","APPROVE","TRANSMIT","RECEIVE","ACCEPT","CONTROL","CONFIGURE"]'
    WHEN 'CONTROLLER' THEN '["READ","CREATE","REVISE","TRANSMIT","RECEIVE","ACCEPT","CONTROL"]'
    WHEN 'APPROVER'   THEN '["READ","REVIEW","APPROVE","RECEIVE"]'
    WHEN 'REVIEWER'   THEN '["READ","REVIEW","RECEIVE"]'
    WHEN 'AUTHOR'     THEN '["READ","CREATE","REVISE","RECEIVE"]'
    ELSE '["READ"]'
  END,
  'Published on adoption of the permission matrix; refine per classification.',
  0, CURRENT_TIMESTAMP
FROM "Function" f;

-- RedefineTables — membership now names a function instead of a role.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ProjectMembership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "functionId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectMembership_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectMembership_functionId_fkey" FOREIGN KEY ("functionId") REFERENCES "Function" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ProjectMembership" ("id", "projectId", "userId", "functionId", "active", "createdAt")
SELECT m."id", m."projectId", m."userId", 'fn-' || p."orgId" || '-' || m."role", m."active", m."createdAt"
FROM "ProjectMembership" m
JOIN "Project" p ON p."id" = m."projectId";
DROP TABLE "ProjectMembership";
ALTER TABLE "new_ProjectMembership" RENAME TO "ProjectMembership";
CREATE INDEX "ProjectMembership_userId_idx" ON "ProjectMembership"("userId");
CREATE INDEX "ProjectMembership_functionId_idx" ON "ProjectMembership"("functionId");
CREATE UNIQUE INDEX "ProjectMembership_projectId_userId_key" ON "ProjectMembership"("projectId", "userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

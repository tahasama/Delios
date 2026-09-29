-- A register view somebody keeps: the question they ask every morning, under a
-- name. The filters already live in the address, so a view is that address.
CREATE TABLE "RegisterView" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "query" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RegisterView_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RegisterView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RegisterView_projectId_userId_name_key" ON "RegisterView"("projectId", "userId", "name");
CREATE INDEX "RegisterView_projectId_userId_idx" ON "RegisterView"("projectId", "userId");

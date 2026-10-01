-- A transmittal is never changed after it went. One that completes it (a
-- person or a document left out) or corrects it (a package they rejected)
-- is a new transmittal that says which one it follows, and how.
ALTER TABLE "Transmittal" ADD COLUMN "followsId" TEXT REFERENCES "Transmittal" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Transmittal" ADD COLUMN "followKind" TEXT;
CREATE INDEX "Transmittal_followsId_idx" ON "Transmittal"("followsId");

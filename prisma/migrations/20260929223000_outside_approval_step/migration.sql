-- A review step may exist only to carry an outside party's approval of a
-- release: their answer releases and issues the revision, or sends it back.
ALTER TABLE "ReviewCycle" ADD COLUMN "issueRequestId" TEXT REFERENCES "IssueRequest"("id");
CREATE INDEX "ReviewCycle_issueRequestId_idx" ON "ReviewCycle"("issueRequestId");

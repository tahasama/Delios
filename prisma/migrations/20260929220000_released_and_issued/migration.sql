-- Released and issued become one act. A revision carries the moment it was
-- issued beside the moment it was released; they are stamped together.
ALTER TABLE "Revision" ADD COLUMN "issuedAt" DATETIME;

-- An issue request may say that an outside party has to approve the revision
-- before it is released at all.
ALTER TABLE "IssueRequest" ADD COLUMN "needsApproval" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "IssueRequest" ADD COLUMN "approverId" TEXT REFERENCES "Party"("id");

-- Everything released before this rule existed was released without the two
-- acts being tied together. It was issued when it was released, and the record
-- now says so rather than leaving the column empty and the register uneven.
UPDATE "Revision" SET "issuedAt" = "releasedAt" WHERE "releasedAt" IS NOT NULL;

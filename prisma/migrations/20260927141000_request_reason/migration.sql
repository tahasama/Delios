-- What is asked of a recipient is the reason for issue, from the published set,
-- not a choice between two fixed kinds: an organization may be asked to price
-- it, to review it, or simply to have it.
ALTER TABLE "IssueRequest" RENAME COLUMN "kind" TO "reason";
UPDATE "IssueRequest" SET "reason" = 'INFORMATION' WHERE "reason" = 'ISSUE';

-- A comment that stops the release says what closes it: the next revision, or
-- another step of the same route. "Approved under reserve of the architect" is
-- a comment with a name against it, not a second kind of record.
ALTER TABLE "ReviewComment" ADD COLUMN "closesWith" TEXT NOT NULL DEFAULT 'REVISION';
ALTER TABLE "ReviewComment" ADD COLUMN "closesWithStep" INTEGER;

-- An activity may carry a description of its own: a schedule's names are often
-- codes and abbreviations, and the description is what makes them readable.
ALTER TABLE "Action" ADD COLUMN "description" TEXT;

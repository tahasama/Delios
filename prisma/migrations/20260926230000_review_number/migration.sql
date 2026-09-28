-- A review is a record like a transmittal or an action, so it carries its own
-- number. Reviews raised before this migration keep none, and read by their
-- document and revision as they always did.
ALTER TABLE "ReviewCycle" ADD COLUMN "number" TEXT;

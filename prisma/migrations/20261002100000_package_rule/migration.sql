-- A package may be filled by a rule as well as by hand: the rule is kept as a
-- filter, and what was taken out by hand stays out.
ALTER TABLE "Package" ADD COLUMN "membershipFilter" TEXT;
ALTER TABLE "Package" ADD COLUMN "membershipExcluded" TEXT;

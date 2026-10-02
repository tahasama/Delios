-- Several people may put a package together, or accept it.
ALTER TABLE "Package" ADD COLUMN "compositionOwnerIds" TEXT;
ALTER TABLE "Package" ADD COLUMN "acceptanceAuthorityIds" TEXT;

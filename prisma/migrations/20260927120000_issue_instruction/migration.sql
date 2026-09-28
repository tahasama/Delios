-- The deciding step says what should happen to the revision once it is
-- released, and Document Control carries it out. A project that wants no gate
-- sets issueGate to IMMEDIATE, and the decision does both at once.
ALTER TABLE "Revision" ADD COLUMN "issueInstruction" TEXT;
ALTER TABLE "Revision" ADD COLUMN "issueInstructionAt" DATETIME;
ALTER TABLE "Revision" ADD COLUMN "issueInstructionBy" TEXT;
ALTER TABLE "ScopeConfig" ADD COLUMN "issueGate" TEXT NOT NULL DEFAULT 'CONTROL';

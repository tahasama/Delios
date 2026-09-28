-- An organization may decide it does not want issuing to be asked for at all:
-- its people raise a transmittal when they need one, and nothing asks or sends
-- on their behalf.
ALTER TABLE "ScopeConfig" ADD COLUMN "useIssueRequests" BOOLEAN NOT NULL DEFAULT true;

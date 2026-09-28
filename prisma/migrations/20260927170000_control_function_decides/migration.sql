-- Whether a project has a control stage is not a workflow setting: it is the
-- fact of whether anybody holds the control function on it. Two settings that
-- asked the same question in workflow words are gone; the matrix answers it.
ALTER TABLE "ScopeConfig" DROP COLUMN "issueGate";
ALTER TABLE "ScopeConfig" DROP COLUMN "useIssueRequests";

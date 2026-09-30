-- A transmittal is no longer closed. Each one that was is put back where it
-- stood before closing: accepted if it passed the check on arrival, issued
-- otherwise. The close itself stays in the audit trail.
UPDATE "Transmittal"
SET "status" = CASE
  WHEN "acceptanceCheckedAt" IS NOT NULL AND "rejectionReason" IS NULL THEN 'ACCEPTED'
  ELSE 'ISSUED'
END
WHERE "status" = 'CLOSED';

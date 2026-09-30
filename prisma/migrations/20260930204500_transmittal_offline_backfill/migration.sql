-- A review step carried for an organization with no accounts here already
-- raised a transmittal when it was sent, but the transmittal's row for that
-- organization said nothing about it, so it read as never sent. The step holds
-- the record — the day, how, their reference, the proof — so the row is given
-- the same. Whoever raised that transmittal is whoever sent it.
UPDATE "TransmittalRecipient"
SET
  "partyId"          = (SELECT rc."partyId" FROM "ReviewCycle" rc JOIN "Party" p ON p."id" = rc."partyId"
                        WHERE rc."transmittalId" = "TransmittalRecipient"."transmittalId" AND rc."dispatchedAt" IS NOT NULL
                          AND p."name" = "TransmittalRecipient"."organization" ORDER BY rc."dispatchedAt" LIMIT 1),
  "dispatchedAt"     = (SELECT rc."dispatchedAt" FROM "ReviewCycle" rc JOIN "Party" p ON p."id" = rc."partyId"
                        WHERE rc."transmittalId" = "TransmittalRecipient"."transmittalId" AND rc."dispatchedAt" IS NOT NULL
                          AND p."name" = "TransmittalRecipient"."organization" ORDER BY rc."dispatchedAt" LIMIT 1),
  "dispatchChannel"  = (SELECT rc."dispatchChannel" FROM "ReviewCycle" rc JOIN "Party" p ON p."id" = rc."partyId"
                        WHERE rc."transmittalId" = "TransmittalRecipient"."transmittalId" AND rc."dispatchedAt" IS NOT NULL
                          AND p."name" = "TransmittalRecipient"."organization" ORDER BY rc."dispatchedAt" LIMIT 1),
  "dispatchRef"      = (SELECT rc."dispatchRef" FROM "ReviewCycle" rc JOIN "Party" p ON p."id" = rc."partyId"
                        WHERE rc."transmittalId" = "TransmittalRecipient"."transmittalId" AND rc."dispatchedAt" IS NOT NULL
                          AND p."name" = "TransmittalRecipient"."organization" ORDER BY rc."dispatchedAt" LIMIT 1),
  "dispatchedByName" = (SELECT t."createdByName" FROM "Transmittal" t WHERE t."id" = "TransmittalRecipient"."transmittalId"),
  "proofFileId"      = (SELECT f."id" FROM "StoredFile" f JOIN "ReviewCycle" rc ON rc."id" = f."cycleId" JOIN "Party" p ON p."id" = rc."partyId"
                        WHERE rc."transmittalId" = "TransmittalRecipient"."transmittalId" AND f."kind" = 'EVIDENCE'
                          AND p."name" = "TransmittalRecipient"."organization" ORDER BY f."createdAt" LIMIT 1)
WHERE "userId" IS NULL
  AND "dispatchedAt" IS NULL
  AND EXISTS (SELECT 1 FROM "ReviewCycle" rc JOIN "Party" p ON p."id" = rc."partyId"
              WHERE rc."transmittalId" = "TransmittalRecipient"."transmittalId" AND rc."dispatchedAt" IS NOT NULL
                AND p."name" = "TransmittalRecipient"."organization");

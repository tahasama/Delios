-- An answer is a transmittal, not a note.
--
-- A reply carries its own number, its own recipients and its own enclosures,
-- and the people copied in on the question are copied in on the answer. It was
-- briefly a free-text note; that was a note where correspondence belonged, and
-- nothing had been written into it.
ALTER TABLE "Transmittal" ADD COLUMN "inReplyToId" TEXT REFERENCES "Transmittal" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Transmittal_inReplyToId_idx" ON "Transmittal"("inReplyToId");

DROP TABLE IF EXISTS "TransmittalReply";

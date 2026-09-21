-- Add authenticated notification, opening and repeat-view evidence to each named recipient.
ALTER TABLE "TransmittalRecipient" ADD COLUMN "notifiedAt" DATETIME;
ALTER TABLE "TransmittalRecipient" ADD COLUMN "openedAt" DATETIME;
ALTER TABLE "TransmittalRecipient" ADD COLUMN "lastViewedAt" DATETIME;
ALTER TABLE "TransmittalRecipient" ADD COLUMN "viewCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "TransmittalRecipient_userId_idx" ON "TransmittalRecipient"("userId");

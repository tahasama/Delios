-- A revision is released or returned, and a returned one is replaced rather
-- than corrected: it keeps what was submitted and what was said about it.
ALTER TABLE "Revision" ADD COLUMN "returnedAt" DATETIME;
ALTER TABLE "Revision" ADD COLUMN "returnedReason" TEXT;

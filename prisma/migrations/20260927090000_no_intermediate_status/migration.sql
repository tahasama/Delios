-- A revision has a status only once Document Control publishes one. Where it
-- stands while a route runs is the route's business, and why it goes out is the
-- reason for issue on the transmittal that carries it. The intermediate status
-- was a second way of saying both, shaped like the thing it was not.
ALTER TABLE "Revision" DROP COLUMN "handedOnStatus";
ALTER TABLE "ReviewCycle" DROP COLUMN "handsOnStatus";

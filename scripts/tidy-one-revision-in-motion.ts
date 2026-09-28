/**
 * One revision in motion per document.
 *
 * The rule is enforced from now on, but records made before it existed can still
 * have two or three revisions open at once. This closes the older ones: their
 * routes are returned, their reviews closed, and the revision itself marked void
 * with the reason — an abandoned attempt, which is what it was. The newest one is
 * left in motion.
 *
 *   npx tsx scripts/tidy-one-revision-in-motion.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const documents = await db.document.findMany({ include: { revisions: { orderBy: { createdAt: "desc" } } } });
  let cleared = 0;
  for (const document of documents) {
    const moving = document.revisions.filter((rev) => rev.state === "IN_PREPARATION" || rev.state === "IN_REVIEW");
    if (moving.length < 2) continue;
    const [kept, ...stale] = moving;
    for (const rev of stale) {
      await db.workflowRun.updateMany({ where: { revisionId: rev.id, status: "ACTIVE" }, data: { status: "RETURNED" } });
      await db.reviewCycle.updateMany({ where: { revisionId: rev.id, status: "OPEN" }, data: { status: "CLOSED", returnedToOriginatorAt: new Date() } });
      await db.revision.update({
        where: { id: rev.id },
        data: {
          state: "VOID",
          voidReason: "Abandoned attempt — a document has one revision in motion at a time.",
          voidedAt: new Date(),
        },
      });
      cleared++;
      console.log(`${document.docNumber}: rev ${rev.value} closed.`);
    }
    console.log(`${document.docNumber}: rev ${kept.value} left in motion.`);
  }
  console.log(cleared ? `${cleared} abandoned revision(s) closed.` : "Nothing to close — every document already has one revision in motion.");
}

main()
  .catch((error) => { console.error(error); process.exit(1); })
  .finally(() => db.$disconnect());

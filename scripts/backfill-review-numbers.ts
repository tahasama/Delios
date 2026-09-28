/**
 * Give every review raised before review numbering its number.
 *
 * Reviews are numbered by the same machinery as transmittals and actions: a
 * scheme the organization publishes. Older reviews carry none, so they read as
 * "—" in the register until this runs. Numbers are handed out oldest first, so
 * the sequence follows the order the reviews actually happened in.
 *
 *   npx tsx scripts/backfill-review-numbers.ts
 */
import { PrismaClient } from "@prisma/client";
import { tenantFor } from "../src/lib/tenant";
import { reviewNumber } from "../src/lib/workflow";

const db = new PrismaClient();

async function main() {
  const projects = await db.project.findMany({ orderBy: { createdAt: "asc" } });
  let given = 0;
  for (const project of projects) {
    const t = tenantFor(project.orgId, project.id);
    const cycles = await db.reviewCycle.findMany({
      where: { projectId: project.id, number: null },
      orderBy: { submittedAt: "asc" },
      select: { id: true },
    });
    for (const cycle of cycles) {
      const number = await reviewNumber(t);
      await db.reviewCycle.update({ where: { id: cycle.id }, data: { number } });
      given++;
    }
    if (cycles.length) console.log(`${project.code}: ${cycles.length} review(s) numbered.`);
  }
  console.log(given ? `${given} review(s) numbered.` : "Every review already has a number.");
}

main()
  .catch((error) => { console.error(error); process.exit(1); })
  .finally(() => db.$disconnect());

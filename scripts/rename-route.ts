/**
 * Rename a review route. Routes read as "what it covers — who decides it", so a
 * list of them reads as a list of answers to the only two questions a sender
 * has when choosing one.
 *
 *   npx tsx scripts/rename-route.ts "old name" "new name"
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const [from, to] = process.argv.slice(2);
  if (!from || !to) throw new Error('Give the old name and the new one: npx tsx scripts/rename-route.ts "old" "new"');
  const route = await db.workflowTemplate.findFirst({ where: { name: from } });
  if (!route) throw new Error(`No route called "${from}".`);
  await db.workflowTemplate.update({ where: { id: route.id }, data: { name: to } });
  // Runs keep the name they started under, so history stays true; only runs
  // still going are worth moving to the new name.
  await db.workflowRun.updateMany({ where: { templateId: route.id, status: "ACTIVE" }, data: { templateName: to } });
  console.log(`"${from}" is now "${to}".`);
}

main()
  .catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); })
  .finally(() => db.$disconnect());

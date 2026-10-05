import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { tenantFor } from "../src/lib/tenant";
import { restateAction } from "../src/lib/action-readiness";

/**
 * Write back, on every action, what it is waiting for.
 *
 * The schedule filters and sorts on counters kept on the action itself — how
 * many documents it needs, how many are met, when the next one is owed. The
 * application maintains them whenever a line is added or removed, but anything
 * written around it (a seed, an older import) leaves them at zero, and an
 * action that needs nothing matches no state at all: the filters come back
 * empty and the plan looks idle.
 *
 * This restates them all. It reads the same lines the application reads and
 * invents nothing.
 */
const db = new PrismaClient();

async function main() {
  const projects = await db.project.findMany({ select: { id: true, code: true, orgId: true } });
  let total = 0;
  for (const project of projects) {
    const actions = await db.action.findMany({ where: { projectId: project.id }, select: { id: true } });
    if (!actions.length) continue;
    const t = tenantFor(project.orgId, project.id);
    for (const action of actions) await restateAction(t, action.id);
    const waiting = await db.action.count({ where: { projectId: project.id, needCount: { gt: 0 } } });
    console.log(`· ${project.code} — ${actions.length} activities restated, ${waiting} waiting on documents`);
    total += actions.length;
  }
  console.log(`${total} activities restated.`);
}

main().finally(() => db.$disconnect());

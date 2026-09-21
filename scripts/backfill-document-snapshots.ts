import { db } from "../src/lib/db";
import { tenantFor } from "../src/lib/tenant";
import { captureDocumentSnapshot } from "../src/lib/history";

async function main() {
  const projects = await db.project.findMany({ orderBy: { code: "asc" } });
  let created = 0;
  for (const project of projects) {
    const tenant = tenantFor(project.orgId, project.id);
    const documents = await tenant.db.document.findMany({
      select: { id: true, docNumber: true, createdAt: true, createdByName: true, snapshots: { select: { id: true }, take: 1 } },
    });
    for (const document of documents) {
      if (document.snapshots.length) continue;
      await captureDocumentSnapshot(tenant, document.id, {
        eventType: "HISTORY_BASELINE",
        eventLabel: "Baseline captured when point-in-time history was enabled.",
        actorName: document.createdByName || "system",
        capturedAt: new Date(),
      });
      created++;
    }
  }
  console.log(`Created ${created} baseline document snapshot(s).`);
}

main().finally(() => db.$disconnect());

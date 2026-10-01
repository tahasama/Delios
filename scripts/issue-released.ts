/**
 * Released is issued, and issued is released. Records made without the app —
 * the demo seeds set revisions released directly — can be released without
 * ever having gone to anybody, which the app itself no longer allows. This
 * sends each of them the way the app would have: an issue request to the
 * document's author, carried out into a transmittal, dated the day it was
 * released.
 *
 *   npx tsx scripts/issue-released.ts
 *
 * Meant for demo and test data. On real records, a released revision nobody
 * was sent is a finding to look into, not something to paper over.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { tenantFor } from "../src/lib/tenant";
import { carryOutRequest } from "../src/lib/issue-requests";

const db = new PrismaClient();

async function main() {
  const projects = await db.project.findMany({ select: { id: true, orgId: true, code: true } });
  let sent = 0;
  for (const project of projects) {
    const t = tenantFor(project.orgId, project.id);
    const unsent = await t.db.revision.findMany({
      where: { state: "RELEASED", heldAt: null, transmittalItems: { none: { transmittal: { direction: "OUTGOING" } } } },
      include: { document: true },
    });
    if (!unsent.length) continue;
    const reasons = await t.db.configValue.findMany({ where: { setKey: "REASONS_FOR_ISSUE", status: "ACTIVE" }, orderBy: { sort: "asc" } });
    const reason = reasons.find((one) => one.code === "INFORMATION")?.code ?? reasons[0]?.code ?? "INFORMATION";
    for (const rev of unsent) {
      const by = { id: rev.releasedById ?? rev.document.createdById, name: rev.releasedByName ?? rev.document.createdByName };
      const request = await t.db.issueRequest.create({
        data: {
          projectId: project.id, revisionId: rev.id, reason,
          recipients: JSON.stringify({ internalUserIds: [rev.document.createdById], partyIds: [] }),
          note: "Issued when it was released.", raisedById: by.id, raisedByName: by.name,
        },
      });
      const result = await carryOutRequest(t, request.id, by);
      if (result.error) {
        console.log(`  ${rev.document.docNumber} rev ${rev.value}: ${result.error}`);
        await t.db.issueRequest.delete({ where: { id: request.id } });
        continue;
      }
      // The transmittal is dated the day the revision was released: the two are one act.
      const done = await t.db.issueRequest.findUniqueOrThrow({ where: { id: request.id } });
      if (done.transmittalId && rev.releasedAt) {
        await t.db.transmittal.update({ where: { id: done.transmittalId }, data: { dateOfIssue: rev.releasedAt } });
      }
      sent++;
    }
    console.log(`${project.code}: ${unsent.length} released revision(s) found unsent`);
  }
  console.log(`${sent} issued.`);
  await db.$disconnect();
}

main();

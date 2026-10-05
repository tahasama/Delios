// A supplier package to try the supplier flow end to end:
//   Acme Pumps's package holds every document Acme Pumps owes us, including two new
//   placeholders with nothing sent yet. Re-running resets the two placeholders.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const PLACEHOLDERS = [
  { docNumber: "P1001-50-ACME-PO101-ME-DGA-00001", title: "Feed pump P-101 — general arrangement drawing", docType: "LAY" },
  { docNumber: "P1001-50-ACME-PO101-ME-DAS-00002", title: "Feed pump P-101 — performance curves", docType: "DAT" },
];

async function main() {
  const org = await db.organization.findFirstOrThrow({ where: { slug: "our-org" } });
  const p1 = await db.project.findFirstOrThrow({ where: { orgId: org.id, code: "P1001" } });
  const controller = await db.user.findFirstOrThrow({ where: { orgId: org.id, email: "controller@delios.local" } });
  const approver = await db.user.findFirstOrThrow({ where: { orgId: org.id, email: "approver@delios.local" } });
  const party = await db.party.findFirstOrThrow({ where: { orgId: org.id, code: "ACME" } });

  // Revisions that already arrived on an incoming transmittal count as sent.
  const carried = await db.transmittalItem.findMany({ where: { projectId: p1.id, transmittal: { direction: "INCOMING" }, revision: { document: { originator: "ACME" } } }, include: { transmittal: true } });
  for (const item of carried) {
    await db.revision.update({ where: { id: item.revisionId }, data: { submittedAt: item.transmittal.dateOfIssue, submittedByName: party.name } });
  }

  const due = new Date(Date.now() + 10 * 86_400_000);
  const identifier = "SP-MAD";
  const existing = await db.package.findFirst({ where: { projectId: p1.id, identifier } });
  const data = {
    projectId: p1.id, identifier, category: "SUPPLIER", partyCode: "ACME", purpose: "SUPPLIER_DELIVERABLES", type: "ACCUMULATED",
    membershipRule: `Every document from ${party.name}`, recipientName: party.name, completionDate: due, requiredStatus: "AFC",
    compositionOwnerId: controller.id, compositionOwnerName: controller.name, acceptanceAuthorityId: approver.id, acceptanceAuthorityName: approver.name,
  };
  if (existing) await db.package.update({ where: { id: existing.id }, data });
  else await db.package.create({ data });

  for (const p of PLACEHOLDERS) {
    const old = await db.document.findFirst({ where: { projectId: p1.id, docNumber: p.docNumber } });
    if (old) {
      const revs = (await db.revision.findMany({ where: { documentId: old.id }, select: { id: true } })).map((r) => r.id);
      const cycles = (await db.reviewCycle.findMany({ where: { revisionId: { in: revs } }, select: { id: true } })).map((c) => c.id);
      await db.reviewComment.deleteMany({ where: { cycleId: { in: cycles } } });
      await db.reviewAssignment.deleteMany({ where: { cycleId: { in: cycles } } });
      await db.reviewCycle.deleteMany({ where: { id: { in: cycles } } });
      await db.approval.deleteMany({ where: { revisionId: { in: revs } } });
      await db.workflowRun.deleteMany({ where: { revisionId: { in: revs } } });
      await db.transmittalItem.deleteMany({ where: { revisionId: { in: revs } } });
      await db.storedFile.deleteMany({ where: { revisionId: { in: revs } } });
      await db.documentSnapshot.deleteMany({ where: { documentId: old.id } });
      await db.revision.deleteMany({ where: { id: { in: revs } } });
      await db.document.delete({ where: { id: old.id } });
    }
    await db.document.create({
      data: {
        projectId: p1.id, docNumber: p.docNumber, title: p.title, deliverableType: "VND", docType: p.docType, discipline: "ME",
        originator: "ACME", subProject: "50", criticality: "ROUTINE", confidentiality: "INTERNAL", state: "PLANNED", isPlaceholder: true,
        createdById: controller.id, createdByName: controller.name,
      },
    });
    console.log(`placeholder: ${p.docNumber}`);
  }
  console.log(`package: ${identifier} — /packages/${identifier}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

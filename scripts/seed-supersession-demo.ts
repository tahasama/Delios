// A replaced revision whose outside recipients were never told — to try
// Assurance → Out-of-date risks → "Send rev B to them" end to end.
//
// Q6637021-74-ME-DSW-09201 rev A was released at IFC and issued on a
// transmittal to two people outside (MADASUD, ONEE) and one reviewer here.
// Rev B has since been released. The reviewer was told in the app; the two
// outsiders were not. Re-running resets the example.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const DOC = "Q6637021-74-ME-DSW-09201";
const TAG = "[supersession demo]";

async function nextTr(projectId: string) {
  const c = await db.numberCounter.findUnique({ where: { projectId_prefix: { projectId, prefix: "TR" } } });
  if (c) { await db.numberCounter.update({ where: { id: c.id }, data: { next: { increment: 1 } } }); return `TR-${String(c.next).padStart(4, "0")}`; }
  await db.numberCounter.create({ data: { projectId, prefix: "TR", next: 2 } });
  return "TR-0001";
}

async function main() {
  const org = await db.organization.findFirstOrThrow({ where: { slug: "our-org" } });
  const p1 = await db.project.findFirstOrThrow({ where: { orgId: org.id, code: "P1" } });
  const who = (email: string) => db.user.findFirstOrThrow({ where: { orgId: org.id, email } });
  const [author, approver, controller, reviewer] = await Promise.all([who("author@delios.local"), who("approver@delios.local"), who("controller@delios.local"), who("reviewer@delios.local")]);
  const pdf = await db.storedFile.findFirstOrThrow({ where: { projectId: p1.id, kind: "RENDITION" } });

  // Reset a previous run: its transmittals first, then the document.
  const old = await db.document.findFirst({ where: { projectId: p1.id, docNumber: DOC } });
  if (old) {
    const revs = (await db.revision.findMany({ where: { documentId: old.id }, select: { id: true } })).map((r) => r.id);
    const items = await db.transmittalItem.findMany({ where: { revisionId: { in: revs } }, select: { transmittalId: true } });
    const trIds = [...new Set(items.map((i) => i.transmittalId))];
    await db.transmittalItem.deleteMany({ where: { transmittalId: { in: trIds } } });
    await db.transmittalRecipient.deleteMany({ where: { transmittalId: { in: trIds } } });
    await db.transmittal.deleteMany({ where: { id: { in: trIds } } });
    await db.approval.deleteMany({ where: { revisionId: { in: revs } } });
    await db.obsolescenceRecord.deleteMany({ where: { documentId: old.id } });
    await db.defect.deleteMany({ where: { documentId: old.id } });
    await db.storedFile.deleteMany({ where: { revisionId: { in: revs }, id: { not: pdf.id } } });
    await db.revision.deleteMany({ where: { id: { in: revs } } });
    await db.relationship.deleteMany({ where: { OR: [{ fromId: old.id }, { toId: old.id }] } });
    await db.document.delete({ where: { id: old.id } });
  }

  const doc = await db.document.create({
    data: {
      projectId: p1.id, docNumber: DOC, title: "Pump house — ventilation layout", deliverableType: "ENG", docType: "DWG", discipline: "ME",
      subProject: "74", criticality: "ROUTINE", confidentiality: "INTERNAL", retentionClass: "PROJECT_DURATION", state: "ACTIVE", isPlaceholder: false,
      createdById: author.id, createdByName: author.name,
    },
  });
  const released = async (value: string, releasedAt: Date, state: "RELEASED" | "SUPERSEDED", reason: string) => {
    const file = await db.storedFile.create({ data: { projectId: p1.id, path: pdf.path, name: `${DOC}_Rev-${value}.pdf`, size: pdf.size, mime: pdf.mime, sha256: pdf.sha256, kind: "RENDITION", uploadedById: author.id, uploadedByName: author.name } });
    const rev = await db.revision.create({
      data: {
        projectId: p1.id, documentId: doc.id, value, series: "DESIGN", state, statusCode: "IFC", reasonForRevision: reason, changeDescription: reason,
        renditionFileId: file.id, releasedAt, releasedById: controller.id, releasedByName: controller.name, issueDate: releasedAt,
        createdAt: new Date(releasedAt.getTime() - 3 * 86_400_000),
        ...(state === "SUPERSEDED" ? { supersededAt: new Date("2026-09-20T09:00:00Z"), supersededById: controller.id } : {}),
      },
    });
    await db.storedFile.update({ where: { id: file.id }, data: { revisionId: rev.id } });
    await db.approval.create({ data: { projectId: p1.id, revisionId: rev.id, approverId: approver.id, approverName: approver.name, approverRole: "Approver", matrixVersion: 1, decidedAt: new Date(releasedAt.getTime() - 86_400_000) } });
    return rev;
  };
  const revA = await released("A", new Date("2026-09-02T09:00:00Z"), "SUPERSEDED", "First issue");
  const revB = await released("B", new Date("2026-09-20T09:00:00Z"), "RELEASED", "Duct route moved clear of the crane rail");
  await db.obsolescenceRecord.create({ data: { projectId: p1.id, kind: "SUPERSEDED", documentId: doc.id, revisionId: revA.id, reason: "Released rev B at IFC", authorityName: controller.name, createdById: controller.id, effectiveDate: new Date("2026-09-20T09:00:00Z") } });

  // Rev A went to two outsiders and one reviewer here.
  const number = await nextTr(p1.id);
  await db.transmittal.create({
    data: {
      projectId: p1.id, number, direction: "OUTGOING", reasonForIssue: "EXECUTION", dateOfIssue: new Date("2026-09-03T08:00:00Z"),
      issuingParty: "Our organization", status: "ISSUED", acceptanceNotes: `${TAG} Ventilation layout for installation.`,
      createdById: controller.id, createdByName: controller.name,
      items: { create: [{ projectId: p1.id, revisionId: revA.id }] },
      recipients: {
        create: [
          { projectId: p1.id, name: "S. Amrani", organization: "MADASUD", notifiedAt: new Date("2026-09-03T08:00:00Z") },
          { projectId: p1.id, name: "K. Idrissi", organization: "ONEE", notifiedAt: new Date("2026-09-03T08:00:00Z") },
          { projectId: p1.id, name: reviewer.name, organization: "Our organization", userId: reviewer.id, notifiedAt: new Date("2026-09-03T08:00:00Z") },
        ],
      },
    },
  });
  console.log(`ready: ${DOC} rev A (on ${number}) replaced by rev B — S. Amrani and K. Idrissi not told`);
  console.log(`       open Assurance → Out-of-date risks; document /documents/${doc.id} (rev B id ${revB.id})`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

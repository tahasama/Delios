// Two documents ready to send down a review route, and the route itself:
//   "3 inputs, then lead" — three specialists give input in any order, then
//   their lead approves. Re-running resets both documents to "ready to send".
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const DOCS = [
  { docNumber: "Q6637021-74-ME-CAL-09101", title: "Pump house — ventilation duct sizing calculation", docType: "CAL", discipline: "ME" },
  { docNumber: "Q6637021-74-EL-DSW-09102", title: "Pump house — lighting layout drawing", docType: "DSW", discipline: "EL" },
];

async function main() {
  const org = await db.organization.findFirstOrThrow({ where: { slug: "our-org" } });
  const p1 = await db.project.findFirstOrThrow({ where: { orgId: org.id, code: "P1" } });
  const who = async (email: string) => db.user.findFirstOrThrow({ where: { orgId: org.id, email } });
  const [r1, r2, comm, lead, author] = await Promise.all([
    who("reviewer@delios.local"), who("reviewer2@delios.local"), who("commissioning@delios.local"),
    who("approver@delios.local"), who("author@delios.local"),
  ]);

  // Who answers for which department: they receive its requirements call
  // and confirm its readiness before an activity.
  const DEPARTMENTS: Record<string, string> = {
    "lead.elec@delios.local": "EL", "tech.elec@delios.local": "EL",
    "commissioning@delios.local": "ME", "reviewer2@delios.local": "ME",
  };
  for (const [email, department] of Object.entries(DEPARTMENTS)) {
    const u = await db.user.findFirst({ where: { orgId: org.id, email } });
    if (u) await db.projectMembership.updateMany({ where: { projectId: p1.id, userId: u.id }, data: { department } });
  }

  // The route.
  const steps = [
    { act: "REVIEW", mode: "ALL", title: "Specialist input", participantIds: [r1.id, r2.id, comm.id] },
    { act: "APPROVAL", mode: "ANY_OF", title: "Lead approval", participantIds: [lead.id] },
  ];
  const existing = await db.workflowTemplate.findFirst({ where: { orgId: org.id, name: "3 inputs, then lead" } });
  if (existing) await db.workflowTemplate.update({ where: { id: existing.id }, data: { steps: JSON.stringify(steps), active: true } });
  else await db.workflowTemplate.create({ data: { orgId: org.id, name: "3 inputs, then lead", description: "Three specialists give input in any order, then their lead approves.", classes: "*", steps: JSON.stringify(steps), active: true, isDefault: false } as never });

  // A route that names nobody: each step is assigned from the distribution
  // matrix by the document's discipline when it is sent.
  const byDiscipline = [
    { act: "REVIEW", mode: "ALL", title: "Discipline review", participantIds: [] },
    { act: "APPROVAL", mode: "ANY_OF", title: "Discipline approval", participantIds: [] },
  ];
  const auto = await db.workflowTemplate.findFirst({ where: { orgId: org.id, name: "By discipline — review, then approval" } });
  if (auto) await db.workflowTemplate.update({ where: { id: auto.id }, data: { steps: JSON.stringify(byDiscipline), active: true } });
  else await db.workflowTemplate.create({ data: { orgId: org.id, name: "By discipline — review, then approval", description: "Reviewers and approver assigned from the distribution matrix by the document's discipline; adjust before sending.", classes: "*", steps: JSON.stringify(byDiscipline), active: true, isDefault: false } as never });

  // "Single approval" names functions, not a person: the matrix decides who.
  const approverFn = await db.function.findFirstOrThrow({ where: { orgId: org.id, code: "APPROVER" } });
  const leadElecFn = await db.function.findFirst({ where: { orgId: org.id, code: "LEAD_ELEC_ENG" } });
  const single = await db.workflowTemplate.findFirst({ where: { orgId: org.id, name: "Single approval" } });
  if (single) {
    await db.workflowTemplate.update({
      where: { id: single.id },
      data: { description: "One approval by whoever the distribution matrix allows to approve this document.", steps: JSON.stringify([{ act: "APPROVAL", mode: "ANY_OF", title: "Approval", participantIds: [], functionIds: [approverFn.id, ...(leadElecFn ? [leadElecFn.id] : [])] }]) },
    });
  }

  // Any viewable PDF already in storage will do as the file.
  const pdf = await db.storedFile.findFirstOrThrow({ where: { projectId: p1.id, kind: "RENDITION" } });

  for (const d of DOCS) {
    // Reset: remove a previous run of this demo.
    const old = await db.document.findFirst({ where: { projectId: p1.id, docNumber: d.docNumber } });
    if (old) {
      const revs = (await db.revision.findMany({ where: { documentId: old.id }, select: { id: true } })).map((r) => r.id);
      const cycles = (await db.reviewCycle.findMany({ where: { revisionId: { in: revs } }, select: { id: true } })).map((c) => c.id);
      await db.reviewComment.deleteMany({ where: { cycleId: { in: cycles } } });
      await db.reviewAssignment.deleteMany({ where: { cycleId: { in: cycles } } });
      await db.reviewCycle.deleteMany({ where: { id: { in: cycles } } });
      await db.approval.deleteMany({ where: { revisionId: { in: revs } } });
      await db.workflowRun.deleteMany({ where: { revisionId: { in: revs } } });
      await db.storedFile.deleteMany({ where: { revisionId: { in: revs }, id: { not: pdf.id } } });
      await db.documentSnapshot.deleteMany({ where: { documentId: old.id } });
      await db.revision.deleteMany({ where: { id: { in: revs } } });
      await db.relationship.deleteMany({ where: { OR: [{ fromId: old.id }, { toId: old.id }] } });
    }

    // A document the requirements list already points at keeps its row.
    const docData = {
      title: d.title, deliverableType: "ENG", docType: d.docType, discipline: d.discipline,
      subProject: "74", criticality: "ROUTINE", confidentiality: "INTERNAL", retentionClass: null, state: "ACTIVE", isPlaceholder: false,
      createdById: author.id, createdByName: author.name,
    };
    const referenced = old ? await db.baselineEntry.count({ where: { documentId: old.id } }) : 0;
    if (old && !referenced) await db.document.delete({ where: { id: old.id } });
    const doc = old && referenced ? await db.document.update({ where: { id: old.id }, data: docData }) : await db.document.create({
      data: {
        projectId: p1.id, docNumber: d.docNumber, title: d.title, deliverableType: "ENG", docType: d.docType, discipline: d.discipline,
        subProject: "74", criticality: "ROUTINE", confidentiality: "INTERNAL", retentionClass: null, state: "ACTIVE", isPlaceholder: false,
        createdById: author.id, createdByName: author.name,
      },
    });
    const file = await db.storedFile.create({
      data: { projectId: p1.id, path: pdf.path, name: `${d.docNumber}_Rev-A.pdf`, size: pdf.size, mime: pdf.mime, sha256: pdf.sha256, kind: "RENDITION", uploadedById: author.id, uploadedByName: author.name },
    });
    const rev = await db.revision.create({
      data: { projectId: p1.id, documentId: doc.id, value: "A", series: "DESIGN", state: "IN_PREPARATION", reasonForRevision: "First issue", changeDescription: "Initial version", renditionFileId: file.id },
    });
    await db.storedFile.update({ where: { id: file.id }, data: { revisionId: rev.id } });
    await db.auditEvent.create({ data: { projectId: p1.id, actorId: author.id, actorName: author.name, action: "REGISTER_ENTRY", entityType: "Document", entityId: doc.id, entityLabel: d.docNumber, detail: "Route demo document — ready to send for review." } });
    console.log(`ready: ${d.docNumber}  /documents/${doc.id}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

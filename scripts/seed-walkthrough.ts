// A walkthrough set: one document sitting at each ordinary point of the
// process, plus the people to sign in as. Nothing exotic — the path a project
// takes every week.
//
//   WALK 1  a draft with its author            (author@delios.local)
//   WALK 2  out for advice                     (reviewer@delios.local)
//   WALK 3  waiting on the decision            (approver@delios.local)
//   WALK 4  decided "to be IFC", not released  (controller@delios.local)
//   WALK 5  released at IFC, told to nobody    (controller@delios.local)
//   WALK 6  issued to the client               (client@delios.local)
//   WALK 7  arrived from a supplier, to check  (controller@delios.local)
//
// Safe to re-run: it recreates its own documents and leaves the rest alone.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { tenantFor } from "../src/lib/tenant";
import { allocateNumber } from "../src/lib/numbering";
import { startWorkflowRun, recordStepOutcome } from "../src/lib/workflow";
import { releaseRevision } from "../src/lib/lifecycle";
import { createPlaceholderRendition } from "../src/lib/stamp";
import { UPLOAD_ROOT } from "../src/lib/files";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import type { SessionUser } from "../src/lib/auth";

const db = new PrismaClient();
const PREFIX = "WALK";
const day = 86_400_000;
const ago = (n: number) => new Date(Date.now() - n * day);

async function main() {
  const org = await db.organization.findFirstOrThrow({ where: { slug: "our-org" } });
  const project = await db.project.findFirstOrThrow({ where: { orgId: org.id, code: "P1001" } });
  const t = tenantFor(org.id, project.id);
  const as = async (email: string): Promise<SessionUser> => {
    const u = await db.user.findFirstOrThrow({ where: { orgId: org.id, email } });
    return { ...u, isInternal: true, partyCode: null } as unknown as SessionUser;
  };

  // ── the client, so someone can look at this from the other side ──────────
  const clientParty =
    (await db.party.findFirst({ where: { orgId: org.id, code: "CLIENT" } })) ??
    (await db.party.create({ data: { orgId: org.id, code: "CLIENT", name: "Riverside Water (client)", isInternal: false } }));
  // The operations handover package is delivered to the client.
  await db.package.updateMany({ where: { identifier: "PK-001", recipientPartyId: null }, data: { recipientPartyId: clientParty.id, recipientName: clientParty.name } });
  const viewerFn = await db.function.findFirstOrThrow({ where: { orgId: org.id, code: "VIEWER" } });
  const client =
    (await db.user.findFirst({ where: { orgId: org.id, email: "client@delios.local" } })) ??
    (await db.user.create({
      data: {
        orgId: org.id, email: "client@delios.local", name: "Client representative", role: "VIEWER",
        passwordHash: await bcrypt.hash("demo1234", 10), partyId: clientParty.id, organization: clientParty.name,
      },
    }));
  if (!(await db.projectMembership.findFirst({ where: { projectId: project.id, userId: client.id } }))) {
    await db.projectMembership.create({ data: { projectId: project.id, userId: client.id, functionId: viewerFn.id, active: true } });
  }
  if (!clientParty.contactId) await db.party.update({ where: { id: clientParty.id }, data: { contactId: client.id } });

  const [admin, control, author, reviewer, approver, vendor] = await Promise.all([
    as("admin@delios.local"), as("controller@delios.local"), as("author@delios.local"),
    as("reviewer@delios.local"), as("approver@delios.local"), as("vendor@delios.local"),
  ]);

  // ── start clean: this script owns every document whose title starts WALK ──
  const mine = await db.document.findMany({ where: { projectId: project.id, title: { startsWith: PREFIX } }, select: { id: true } });
  const ids = mine.map((d) => d.id);
  if (ids.length) {
    const revs = await db.revision.findMany({ where: { documentId: { in: ids } }, select: { id: true } });
    const revIds = revs.map((r) => r.id);
    const cycles = await db.reviewCycle.findMany({ where: { revisionId: { in: revIds } }, select: { id: true } });
    const cycleIds = cycles.map((c) => c.id);
    const transmittals = await db.transmittal.findMany({ where: { items: { some: { revisionId: { in: revIds } } } }, select: { id: true } });
    const tIds = transmittals.map((x) => x.id);
    await db.reviewComment.deleteMany({ where: { cycleId: { in: cycleIds } } });
    await db.reviewAssignment.deleteMany({ where: { cycleId: { in: cycleIds } } });
    await db.reviewCycle.deleteMany({ where: { id: { in: cycleIds } } });
    await db.approval.deleteMany({ where: { revisionId: { in: revIds } } });
    await db.workflowRun.deleteMany({ where: { revisionId: { in: revIds } } });
    await db.transmittalItem.deleteMany({ where: { transmittalId: { in: tIds } } });
    await db.transmittalRecipient.deleteMany({ where: { transmittalId: { in: tIds } } });
    await db.transmittal.deleteMany({ where: { id: { in: tIds } } });
    await db.documentSnapshot.deleteMany({ where: { documentId: { in: ids } } });
    await db.revision.deleteMany({ where: { id: { in: revIds } } });
    await db.document.deleteMany({ where: { id: { in: ids } } });
  }

  const route = await db.workflowTemplate.findFirstOrThrow({ where: { orgId: org.id, active: true, name: { contains: "Review then" } } });
  const codes = await db.configValue.findMany({ where: { orgId: org.id, setKey: "REVIEW_OUTCOMES", status: "ACTIVE" } });
  const props = (v: { props: string | null }) => { try { return v.props ? JSON.parse(v.props) : {}; } catch { return {}; } };
  const accept = codes.find((v) => props(v).proceed === true && props(v).resubmit !== true) ?? codes[0];
  // An earlier step advises, from the advice list; only the last gives the verdict.
  const adviceCodes = await db.configValue.findMany({ where: { orgId: org.id, setKey: "REVIEW_ADVICE", status: "ACTIVE" } });
  const noComment = adviceCodes.find((v) => v.code === "NO_COMMENT") ?? adviceCodes[0];
  const site = await db.user.findMany({ where: { orgId: org.id, email: { in: ["author@delios.local", "author2@delios.local"] } }, select: { id: true } });

  // Each step says what the revision is issued for; the decider also says who
  // receives it, because releasing it is sending it. A step that fails stops
  // the walkthrough rather than leaving a half-made example behind.
  const advise = async (runId: string, note: string) => {
    const done = await recordStepOutcome(t, runId, reviewer, noComment.code, note, "IFR");
    if (!done.ok) throw new Error(done.error);
  };
  const decide = async (runId: string, status: string, to: { internalUserIds: string[]; partyIds: string[] }) => {
    const done = await recordStepOutcome(t, runId, approver, accept.code, "Agreed.", status, false, null, {
      give: true, reason: "INFORMATION", recipients: to, delegated: false, note: null, needsApproval: false, approverId: null,
    });
    if (!done.ok) throw new Error(done.error);
  };
  const toSite = { internalUserIds: site.map((one) => one.id), partyIds: [] };

  async function make(n: number, title: string, discipline: string, docType: string, deliverableType = "ENG", originator: string | null = null) {
    const { docNumber } = await allocateNumber(t, deliverableType, {
      "Project code": "P1001", Subproject: "50", Discipline: discipline, "Document type": docType,
      "Supplier code": originator ?? "ACME", "Purchase order": "PO101",
    });
    const doc = await t.db.document.create({
      data: {
        projectId: project.id, docNumber, title: `${PREFIX} ${n} — ${title}`, deliverableType, docType, discipline,
        criticality: "ROUTINE", confidentiality: "INTERNAL", state: "ACTIVE", originator,
        createdById: author.id, createdByName: author.name, createdDate: ago(20), retentionClass: "PROJECT_LIFE",
      },
    });
    const rev = await t.db.revision.create({
      data: { projectId: project.id, documentId: doc.id, value: "A", state: "IN_PREPARATION", createdAt: ago(18), reasonForRevision: "First issue" },
    });
    await attach(docNumber, rev.id, rev.value);
    return { doc, rev };
  }

  // A revision cannot be released without a readable copy and a word on what
  // changed, so every walkthrough revision carries both.
  let files = 0;
  async function attach(docNumber: string, revisionId: string, revValue: string) {
    files++;
    const bytes = await createPlaceholderRendition({
      docNumber, rev: revValue, statusLabel: "Walkthrough copy", date: new Date(), state: "RELEASED",
      title: docNumber, content: "A stand-in page, so the walkthrough behaves like the real thing.",
    });
    const relPath = path.join(docNumber, `walkthrough-${files}__${docNumber}_Rev-${revValue}.pdf`);
    const abs = path.join(UPLOAD_ROOT, relPath);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, bytes);
    const file = await t.db.storedFile.create({
      data: {
        projectId: project.id, name: `${docNumber}_Rev-${revValue}.pdf`, path: relPath, size: bytes.length,
        mime: "application/pdf", sha256: createHash("sha256").update(bytes).digest("hex"), kind: "RENDITION", revisionId,
      },
    });
    await t.db.revision.update({ where: { id: revisionId }, data: { renditionFileId: file.id, changeDescription: "First issue for the walkthrough." } });
  }

  const line: string[] = [];

  // 1 — a draft, with its author
  const w1 = await make(1, "Pump house ventilation — draft with its author", "ME", "CAL");
  line.push(`WALK 1 ${w1.doc.docNumber} — draft (author@delios.local)`);

  // 2 — out for advice
  const w2 = await make(2, "Switchroom earthing — out for advice", "EL", "CAL");
  const r2 = await startWorkflowRun(t, w2.rev.id, route.id, control, [[reviewer.id], [approver.id]]);
  if (!r2.ok) throw new Error(r2.error);
  line.push(`WALK 2 ${w2.doc.docNumber} — advice step (reviewer@delios.local)`);

  // 3 — the reviewer has advised; the decision is waiting
  const w3 = await make(3, "Feed pump foundation — waiting on the decision", "CI", "CAL");
  const r3 = await startWorkflowRun(t, w3.rev.id, route.id, control, [[reviewer.id], [approver.id]]);
  if (!r3.ok) throw new Error(r3.error);
  await advise(r3.runId, "Checked against the loading schedule.");
  line.push(`WALK 3 ${w3.doc.docNumber} — decision step (approver@delios.local)`);

  // 4 — decided "to be IFC", not released
  const w4 = await make(4, "Cable trench layout — decided, waiting to be released", "EL", "DSW");
  const r4 = await startWorkflowRun(t, w4.rev.id, route.id, control, [[reviewer.id], [approver.id]]);
  if (!r4.ok) throw new Error(r4.error);
  await advise(r4.runId, "No comment.");
  await decide(r4.runId, "IFC", toSite);
  line.push(`WALK 4 ${w4.doc.docNumber} — decided to be IFC, release it (controller@delios.local)`);

  // 5 — released at IFC, and sent to the site team in the same act
  const w5 = await make(5, "Lighting layout — released and issued to site", "EL", "DSW");
  const r5 = await startWorkflowRun(t, w5.rev.id, route.id, control, [[reviewer.id], [approver.id]]);
  if (!r5.ok) throw new Error(r5.error);
  await advise(r5.runId, "No comment.");
  await decide(r5.runId, "IFC", toSite);
  await releaseRevision(t, w5.rev.id, control, "IFC");
  line.push(`WALK 5 ${w5.doc.docNumber} — released IFC and issued to site (controller@delios.local)`);

  // 6 — released and issued to the client
  const w6 = await make(6, "General arrangement — issued to the client", "ME", "DGA");
  const r6 = await startWorkflowRun(t, w6.rev.id, route.id, control, [[reviewer.id], [approver.id]]);
  if (!r6.ok) throw new Error(r6.error);
  await advise(r6.runId, "No comment.");
  await decide(r6.runId, "IFA", { internalUserIds: [client.id], partyIds: [] });
  await releaseRevision(t, w6.rev.id, control, "IFA");
  const number = `TR-W${Date.now().toString(36).slice(-4).toUpperCase()}`;
  const out = await t.db.transmittal.create({
    data: {
      projectId: project.id, number, direction: "OUTGOING", status: "ISSUED", reasonForIssue: "APPROVAL",
      issuingParty: "Our organization", dateOfIssue: ago(2), responseRequired: true, responseDueDate: new Date(Date.now() + 10 * day),
      subject: `${w6.doc.docNumber} rev A — for your approval`,
      message: "Please review and return your code within ten working days.",
      createdById: control.id, createdByName: control.name,
      items: { create: [{ projectId: project.id, revisionId: w6.rev.id }] },
      recipients: { create: [{ projectId: project.id, userId: client.id, name: client.name, organization: clientParty.name }] },
    },
  });
  line.push(`WALK 6 ${w6.doc.docNumber} — issued on ${out.number} (client@delios.local)`);

  // 7 — arrived from a supplier, waiting to be checked
  const w7 = await make(7, "Blower datasheet — arrived from the supplier", "ME", "DAS", "VND", "ACME");
  const inbound = await t.db.transmittal.create({
    data: {
      projectId: project.id, number: `TR-W${(Date.now() + 1).toString(36).slice(-4).toUpperCase()}`, direction: "INCOMING", status: "ISSUED",
      reasonForIssue: "REVIEW", issuingParty: "Acme Pumps", dateOfIssue: ago(1), receivedDate: ago(1), responseRequired: true,
      subject: `${w7.doc.docNumber} rev A — for review`, message: "Datasheet for the aeration blower, first issue.",
      createdById: vendor.id, createdByName: vendor.name,
      items: { create: [{ projectId: project.id, revisionId: w7.rev.id }] },
    },
  });
  line.push(`WALK 7 ${w7.doc.docNumber} — arrived on ${inbound.number}, check it (controller@delios.local)`);

  console.log("Walkthrough ready. Everyone signs in with demo1234.\n" + line.map((l) => "  " + l).join("\n"));
  console.log("\n  client@delios.local is new: Riverside Water (client), read-only, sees only what was issued to them.");
  console.log("  Also try: admin@delios.local (settings), author2@delios.local (Civil author), lead.elec@delios.local (Electrical lead).");
}

main().finally(() => db.$disconnect());

// Demo project — a worked example of the Standard: documents in every state,
// live review cycles, transmittals, copies, baseline, packages… and a handful
// of DELIBERATE defects (seeded raw, bypassing app enforcement) so the Annex H
// conformance engine demonstrates real findings, the warrant and the defect workflow.
import type { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { createPlaceholderRendition } from "../src/lib/stamp";
import { reviewNumber } from "../src/lib/workflow";
import { subjectFor } from "../src/lib/transmittal-subject";
import { tenantFor } from "../src/lib/tenant";

const UPLOAD_ROOT = path.join(process.cwd(), "uploads");

const day = 86400000;
const d = (offset: number) => new Date(Date.now() + offset * day);

export async function seedDemoProject(db: PrismaClient, orgId: string, projectId: string) {
  const existing = await db.document.count();
  if (existing > 0) {
    console.log(`· Demo project already seeded (${existing} documents) — skipping.`);
    return;
  }
  console.log("· Seeding the demo project (PRJ P1001 — wastewater treatment works)…");

  const users = {
    admin: await db.user.findUniqueOrThrow({ where: { orgId_email: { orgId, email: "admin@delios.local" } } }),
    controller: await db.user.findUniqueOrThrow({ where: { orgId_email: { orgId, email: "controller@delios.local" } } }),
    approver: await db.user.findUniqueOrThrow({ where: { orgId_email: { orgId, email: "approver@delios.local" } } }),
    reviewer: await db.user.findUniqueOrThrow({ where: { orgId_email: { orgId, email: "reviewer@delios.local" } } }),
    author: await db.user.findUniqueOrThrow({ where: { orgId_email: { orgId, email: "author@delios.local" } } }),
    author2: await db.user.findUniqueOrThrow({ where: { orgId_email: { orgId, email: "author2@delios.local" } } }),
    vendor: await db.user.findUniqueOrThrow({ where: { orgId_email: { orgId, email: "vendor@delios.local" } } }),
  };
  const assets = await db.assetItem.findMany();
  const assetByCode = (code: string) => assets.find((a) => a.code === code)!;

  let counter = 0;
  async function saveSeedFile(docNumber: string, revValue: string, kind: "NATIVE" | "RENDITION", bytes: Uint8Array, bogus = false) {
    counter++;
    const relPath = path.join(docNumber, `seed-${counter}__${docNumber}_Rev-${revValue}${kind === "RENDITION" ? "" : "_native"}.pdf`);
    const abs = path.join(UPLOAD_ROOT, relPath);
    await mkdir(path.dirname(abs), { recursive: true });
    if (!bogus) await writeFile(abs, bytes);
    return db.storedFile.create({
      data: { projectId,
        name: `${docNumber}_Rev-${revValue}.pdf`,
        path: relPath,
        size: bytes.length,
        mime: "application/pdf",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        kind,
      },
    });
  }

  async function rendition(docNumber: string, revValue: string, statusLabel: string, state: "RELEASED" | "SUPERSEDED" | "VOID", content: string, title: string) {
    const bytes = await createPlaceholderRendition({ docNumber, rev: revValue, statusLabel, date: new Date(), state, title, content });
    return saveSeedFile(docNumber, revValue, "RENDITION", bytes);
  }
  const native = (docNumber: string, revValue: string, content: string) =>
    createPlaceholderRendition({ docNumber, rev: revValue, statusLabel: "NATIVE (working copy)", date: new Date(), state: "RELEASED", title: `${docNumber} — native`, content }).then((b) =>
      saveSeedFile(docNumber, revValue, "NATIVE", b)
    );

  type DocSeed = {
    docNumber: string;
    title: string;
    deliverableType: string;
    docType: string;
    discipline: string;
    originator?: string | null;
    contractRef?: string | null;
    subProject?: string | null;
    criticality?: string;
    confidentiality?: string;
    retentionClass?: string;
    assetCodes: string[];
    createdBy?: keyof typeof users;
    isPlaceholder?: boolean;
    state?: string;
    receivedDate?: Date | null;
  };

  async function mkDoc(s: DocSeed) {
    const createdBy = users[s.createdBy ?? "author"];
    const doc = await db.document.create({
      data: { projectId,
        docNumber: s.docNumber,
        title: s.title,
        deliverableType: s.deliverableType,
        docType: s.docType,
        discipline: s.discipline,
        originator: s.originator ?? null,
        subProject: s.subProject ?? s.docNumber.split("-")[1] ?? null,
        contractRef: s.contractRef ?? null,
        criticality: s.criticality ?? "ROUTINE",
        confidentiality: s.confidentiality ?? "INTERNAL",
        retentionClass: s.retentionClass ?? "PROJECT_DURATION",
        state: s.state ?? "ACTIVE",
        isPlaceholder: s.isPlaceholder ?? false,
        createdById: createdBy.id,
        createdByName: createdBy.name,
        receivedDate: s.receivedDate ?? null,
      },
    });
    for (const code of s.assetCodes) {
      await db.relationship.create({
        data: { projectId, kind: "DOC_ASSET", fromType: "Document", fromId: doc.id, toType: "AssetItem", toId: assetByCode(code).id, createdById: createdBy.id },
      });
    }
    await db.auditEvent.create({
      data: { projectId, actorId: createdBy.id, actorName: createdBy.name, action: "REGISTER_ENTRY", entityType: "Document", entityId: doc.id, entityLabel: s.docNumber, detail: "Register entry created; number allocated by the system (§3.7)." },
    });
    return doc;
  }

  type RevSeed = {
    value: string;
    series?: string;
    state: "IN_PREPARATION" | "IN_REVIEW" | "RELEASED" | "SUPERSEDED" | "VOID";
    statusCode?: string | null;
    reason: string;
    change: string;
    releasedAt?: Date;
    supersededAt?: Date;
    voidedAt?: Date;
    authorization?: string;
    withFiles?: boolean;
    withNative?: boolean;
    releasedBy?: keyof typeof users;
    bogusFile?: boolean;
  };

  async function mkRev(docId: string, docNumber: string, s: RevSeed, createdBy: keyof typeof users = "author") {
    const releasedBy = users[s.releasedBy ?? "controller"];
    const data: Parameters<typeof db.revision.create>[0]["data"] = { projectId,
      documentId: docId,
      value: s.value,
      series: s.series ?? "DESIGN",
      state: s.state,
      statusCode: s.statusCode ?? null,
      reasonForRevision: s.reason,
      changeDescription: s.change,
      authorizationReason: s.authorization ?? `Placeholder register entry (§16.8) — authorization for the first revision.`,
      authorizedByName: users[createdBy].name,
      authorizedAt: d(-60),
      issueDate: s.releasedAt ?? d(-40),
      phase: "CONSTRUCTION",
    };
    if (s.state === "RELEASED" || s.state === "SUPERSEDED" || s.state === "VOID") {
      data.releasedAt = s.releasedAt ?? d(-40);
      data.releasedById = releasedBy.id;
      data.releasedByName = releasedBy.name;
    }
    if (s.supersededAt) data.supersededAt = s.supersededAt;
    if (s.voidedAt) {
      data.voidedAt = s.voidedAt;
      data.voidReason = "Issued against the wrong sub-project";
      data.voidAuthority = users.admin.name;
    }
    const rev = await db.revision.create({ data });

    if (s.state === "RELEASED" || s.state === "SUPERSEDED") {
      // approval + release audit (the conformant path)
      if (s.state === "RELEASED" || !s.bogusFile) {
        /* approval handled by caller when conformant */
      }
      if (s.withFiles !== false) {
        const renditionFile = await rendition(docNumber, s.value, s.statusCode ?? "Issued for construction", s.state, `Content of ${docNumber} rev ${s.value}.\n\nDemo rendition produced by the seed.`, docNumber);
        await db.storedFile.update({ where: { id: renditionFile.id }, data: { revisionId: rev.id } });
        await db.revision.update({ where: { id: rev.id }, data: { renditionFileId: renditionFile.id } });
        if (s.withNative !== false) {
          const nativeFile = await native(docNumber, s.value, `Native working copy of ${docNumber} rev ${s.value}.`);
          await db.storedFile.update({ where: { id: nativeFile.id }, data: { revisionId: rev.id } });
          await db.revision.update({ where: { id: rev.id }, data: { nativeFileId: nativeFile.id } });
        }
        if (s.bogusFile) {
          // deliberately broken: StoredFile row whose repository file does not exist (FM-10)
          await db.storedFile.create({
            data: { projectId, name: `${docNumber}_Rev-${s.value}_MISSING.pdf`, path: path.join(docNumber, "missing-from-repository.pdf"), size: 100, mime: "application/pdf", sha256: "0".repeat(64), kind: "RENDITION", revisionId: rev.id },
          });
        }
      }
      await db.auditEvent.create({
        data: { projectId, actorId: releasedBy.id, actorName: releasedBy.name, action: "RELEASE", entityType: "Revision", entityId: rev.id, entityLabel: `${docNumber} rev ${s.value}`, newValue: `Released at ${s.statusCode}`, detail: "Seeded release (§7.5)." },
      });
    }
    return rev;
  }

  async function mkApproval(revId: string, docId: string, docNumber: string, revValue: string, approver: keyof typeof users) {
    const u = users[approver];
    // The authority is the function the person holds on this project, exactly as
    // a real approval records it — not the word "APPROVER".
    const held = await db.projectMembership.findFirst({ where: { projectId, userId: u.id, active: true }, include: { function: { select: { name: true } } } });
    await db.approval.create({
      data: { projectId, revisionId: revId, approverId: u.id, approverName: u.name, approverRole: held?.function.name ?? "Approver", matrixVersion: 1, decidedAt: d(-41) },
    });
    await db.auditEvent.create({
      data: { projectId, actorId: u.id, actorName: u.name, action: "APPROVAL", entityType: "Revision", entityId: revId, entityLabel: `${docNumber} rev ${revValue}`, detail: "Approved under authority matrix v1 (§8.3)." },
    });
    void docId; void docNumber;
  }

  // The demo answers from the organization's published verdict list, exactly as
  // a reviewer does. It used to write the Standard's own consequence names
  // (APPROVED_WITH_COMMENTS and friends), which are not codes anybody
  // publishes, so the register printed them raw.
  const publishedVerdicts = (await db.configValue.findMany({ where: { orgId, setKey: "REVIEW_OUTCOMES", status: "ACTIVE" } }))
    .map((v) => ({ code: v.code, props: v.props ? (JSON.parse(v.props) as { proceed?: boolean; resubmit?: boolean }) : {} }));
  const verdictCode = (kind: "accept" | "accept_with_comments" | "return") => {
    const match = publishedVerdicts.find((v) =>
      kind === "return" ? v.props.proceed !== true
        : kind === "accept_with_comments" ? v.props.proceed === true && v.props.resubmit === true
          : v.props.proceed === true && v.props.resubmit !== true);
    return match?.code ?? publishedVerdicts[0]?.code ?? "C1";
  };

  async function mkCycle(
    revId: string, docId: string, docNumber: string, revValue: string,
    opts: { seq: number; outcome?: string; open?: boolean; issued?: boolean; blockingComment?: boolean; note?: string }
  ) {
    const cycle = await db.reviewCycle.create({
      data: { projectId,
        // A review is referred to by its number, like a transmittal.
        number: await reviewNumber(tenantFor(orgId, projectId)),
        revisionId: revId,
        mode: "PARALLEL",
        sequence: opts.seq,
        status: opts.outcome ? "CLOSED" : "OPEN",
        openedById: users.author.id,
        openedByName: users.author.name,
        submittedAt: d(-30),
        receivedAt: d(-29),
        issuedToReviewAt: opts.issued === false ? null : d(-28),
        returnedFromReviewAt: opts.outcome ? d(-20) : null,
        returnedToOriginatorAt: opts.outcome ? d(-19) : null,
        outcome: opts.outcome ?? null,
        outcomeAt: opts.outcome ? d(-20) : null,
        outcomeByName: opts.outcome ? users.reviewer.name : null,
        outcomeNote: opts.note ?? null,
      },
    });
    await db.reviewAssignment.create({ data: { projectId, cycleId: cycle.id, userId: users.reviewer.id, userName: users.reviewer.name, order: 1, completedAt: opts.outcome ? d(-20) : null } });
    if (opts.blockingComment) {
      await db.reviewComment.create({
        data: { projectId, cycleId: cycle.id, authorId: users.reviewer.id, authorName: users.reviewer.name, text: "Rebar spacing does not match the specification — resolve before any pour proceeds.", classification: "BLOCKING", progressionPreventing: true, status: "OPEN" },
      });
    } else if (opts.outcome) {
      await db.reviewComment.create({
        data: { projectId, cycleId: cycle.id, authorId: users.reviewer.id, authorName: users.reviewer.name, text: "General note: update the title block to the latest issue code.", classification: "NON_BLOCKING", progressionPreventing: false, status: "CLOSED", resolution: "Incorporated in the next revision.", closedAt: d(-19) },
      });
    }
    void docId; void docNumber; void revValue;
    return cycle;
  }

  // ── 1 · GA drawing — the model citizen: A superseded, B current ────────────
  const ga = await mkDoc({ docNumber: "P1001-50-CI-DSW-00001", title: "Non-process building 50 — general arrangement, site works", deliverableType: "ENG", docType: "DSW", discipline: "CI", assetCodes: ["TK-201"], createdBy: "author", criticality: "QUALITY", retentionClass: "ASSET_LIFE" });
  const gaA = await mkRev(ga.id, ga.docNumber, { value: "A", state: "SUPERSEDED", statusCode: "IFC", reason: "First issue for construction", change: "Initial site works GA", releasedAt: d(-50), supersededAt: d(-25) });
  await mkApproval(gaA.id, ga.id, ga.docNumber, "A", "approver");
  await mkCycle(gaA.id, ga.id, ga.docNumber, "A", { seq: 1, outcome: verdictCode("return") });
  const gaB = await mkRev(ga.id, ga.docNumber, { value: "B", state: "RELEASED", statusCode: "AFC", reason: "Client comments incorporated", change: "Drainage invert levels revised from 102.35 to 102.55 m AD", releasedAt: d(-25), authorization: "Review outcome REVISE_AND_RESUBMIT on cycle 1 (§9.3)" });
  await mkApproval(gaB.id, ga.id, ga.docNumber, "B", "approver");
  await mkCycle(gaB.id, ga.id, ga.docNumber, "B", { seq: 2, outcome: verdictCode("accept") });
  await db.notification.create({ data: { projectId, userId: users.author.id, type: "SUPERSEDED", title: `Superseded: ${ga.docNumber} rev A`, body: "Rev B was released at AFC. Stop use; recall or mark controlled copies (§12.2–12.4).", link: `/documents/${ga.id}` } });

  // ── 2 · Foundation drawings — live review, with the reviewer now ───────────
  const fdn = await mkDoc({ docNumber: "P1001-50-CI-DFN-00001", title: "Non-process building 50 — foundation drawings, pump house", deliverableType: "ENG", docType: "DFN", discipline: "CI", assetCodes: ["P-101", "P-102"], createdBy: "author", criticality: "SAFETY", retentionClass: "ASSET_LIFE", state: "PLANNED" });
  const fdnA = await mkRev(fdn.id, fdn.docNumber, { value: "A", state: "IN_REVIEW", reason: "First issue", change: "Foundations for pumps P-101/102", authorization: "Placeholder register entry (§16.8)" });
  await mkCycle(fdnA.id, fdn.id, fdn.docNumber, "A", { seq: 1, open: true });

  // ── 3 · DELIBERATE DEFECT: released with no approval + blocking comment open + missing file ──
  const rebar = await mkDoc({ docNumber: "P1001-50-ST-DSW-00001", title: "Non-process building 50 — reinforcement arrangement, blower house slab", deliverableType: "ENG", docType: "DSW", discipline: "ST", assetCodes: ["BL-301"], createdBy: "author2", criticality: "SAFETY", retentionClass: "ASSET_LIFE" });
  const rebarA = await mkRev(rebar.id, rebar.docNumber, { value: "A", state: "RELEASED", statusCode: "IFC", reason: "First issue", change: "Slab reinforcement", releasedAt: d(-15), bogusFile: true });
  void rebarA;
  // no approval row — ST-07 / AP-01 ▲
  const rebarCycle = await mkCycle((await db.revision.findFirstOrThrow({ where: { documentId: rebar.id } })).id, rebar.id, rebar.docNumber, "A", { seq: 1, outcome: verdictCode("accept_with_comments"), blockingComment: true });
  void rebarCycle; // blocking comment left OPEN on a released revision — RO-14 ▲

  // ── 4 · Vendor datasheet — in preparation by the supplier ─────────────────
  const dat = await mkDoc({ docNumber: "P1001-50-ACME-PO101-ME-DAS-00001", title: "Feed pump P-101 — mechanical datasheet, Acme Pumps offer", deliverableType: "VND", docType: "DAS", discipline: "ME", originator: "ACME", contractRef: "PO101", assetCodes: ["P-101"], createdBy: "vendor", criticality: "QUALITY", retentionClass: "ASSET_LIFE", receivedDate: d(-3), state: "PLANNED" });
  await mkRev(dat.id, dat.docNumber, { value: "A", state: "IN_PREPARATION", reason: "First issue", change: "Datasheet for offer", authorization: "Placeholder register entry (§16.8)" }, "vendor");

  // ── 5 · Vendor calculation — released, issued, controlled copy registered ──
  const calc = await mkDoc({ docNumber: "P1001-50-ACME-PO101-ME-CAL-00001", title: "Feed pump P-101 — induced draft blower sizing calculation", deliverableType: "VND", docType: "CAL", discipline: "ME", originator: "ACME", contractRef: "PO101", assetCodes: ["P-101", "BL-301"], createdBy: "vendor", criticality: "QUALITY", retentionClass: "ASSET_LIFE", receivedDate: d(-20) });
  const calcA = await mkRev(calc.id, calc.docNumber, { value: "A", state: "RELEASED", statusCode: "AFC", reason: "First issue for construction", change: "Blower sizing per revised duty point", releasedAt: d(-18) });
  await mkApproval(calcA.id, calc.id, calc.docNumber, "A", "approver");
  await db.registeredCopy.create({ data: { projectId, revisionId: calcA.id, holder: "Site office — container 4", location: "Non-process building 50 site set", status: "ACTIVE" } });

  // ── 6 · Planned placeholder required by an action ──────────────────────────
  const el = await mkDoc({ docNumber: "P1001-50-EL-DSW-00001", title: "Water tower WT-401 — electrical small power and lighting layout", deliverableType: "ENG", docType: "DSW", discipline: "EL", assetCodes: ["WT-401"], createdBy: "author", isPlaceholder: true, state: "PLANNED", criticality: "QUALITY" });

  // ── 7 · DELIBERATE DEFECT: resubmission required, no revision authorized ────
  const spc = await mkDoc({ docNumber: "P1001-50-CI-SPC-00001", title: "Non-process building 50 — concrete works specification", deliverableType: "ENG", docType: "SPC", discipline: "CI", assetCodes: ["TK-201"], createdBy: "author", criticality: "QUALITY", retentionClass: "ASSET_LIFE" });
  const spcA = await mkRev(spc.id, spc.docNumber, { value: "A", state: "RELEASED", statusCode: "IFR", reason: "Issued for review", change: "First specification issue", releasedAt: d(-22) });
  await mkApproval(spcA.id, spc.id, spc.docNumber, "A", "approver");
  await mkCycle(spcA.id, spc.id, spc.docNumber, "A", { seq: 1, outcome: verdictCode("return"), note: "Curing regime conflicts with the project specification." });
  // no follow-up revision — RO-07 ▲

  // ── 8 · O&M manual — as-built current; stale copy on the superseded rev ────
  const man = await mkDoc({ docNumber: "P1001-40-WW-MAN-00001", title: "Aeration blower BL-301 — operation and maintenance manual", deliverableType: "ENG", docType: "MAN", discipline: "WW", assetCodes: ["BL-301"], createdBy: "author2", criticality: "QUALITY", retentionClass: "PERMANENT" });
  const manA = await mkRev(man.id, man.docNumber, { value: "A", state: "SUPERSEDED", statusCode: "IFC", reason: "First issue", change: "Manual per installed blowers", releasedAt: d(-45), supersededAt: d(-10) });
  await mkApproval(manA.id, man.id, man.docNumber, "A", "approver");
  const manB = await mkRev(man.id, man.docNumber, { value: "B", state: "RELEASED", statusCode: "AB", reason: "As-built update", change: "As-installed blower curve and spare parts list", releasedAt: d(-10), authorization: "Review outcome APPROVED_WITH_COMMENTS on cycle 1 (§9.3)" });
  await mkApproval(manB.id, man.id, man.docNumber, "B", "approver");
  await db.notification.create({ data: { projectId, userId: users.author2.id, type: "SUPERSEDED", title: `Superseded: ${man.docNumber} rev A`, body: "Rev B as-built was released. Stop use (§12.2).", link: `/documents/${man.id}` } });
  await db.registeredCopy.create({ data: { projectId, revisionId: manA.id, holder: "Operations — control room shelf", location: "WT-401 control room", status: "ACTIVE" } }); // OB-08 ▲ + exposure 2
  void manB;

  // ── 9 · DELIBERATE DEFECT: voided, no reassessment recorded ────────────────
  const wrong = await mkDoc({ docNumber: "P1001-20-CI-DSW-00001", title: "Earth works 20 — site protection drawing issued to the wrong package", deliverableType: "ENG", docType: "DSW", discipline: "CI", assetCodes: ["TK-201"], createdBy: "author", criticality: "ROUTINE" });
  const wrongA = await mkRev(wrong.id, wrong.docNumber, { value: "A", state: "VOID", statusCode: "IFI", reason: "Issued for information", change: "Issued in error against sub-project 71", releasedAt: d(-14), voidedAt: d(-12) });
  await mkApproval(wrongA.id, wrong.id, wrong.docNumber, "A", "approver");
  await db.obsolescenceRecord.create({ data: { projectId, kind: "VOID", documentId: wrong.id, revisionId: wrongA.id, reason: "Issued against the wrong sub-project", authorityName: users.admin.name, createdById: users.admin.id } });
  // voidReassessment left null — OB-13 ▲ / exposure 5

  // ── 10 · DELIBERATE DEFECT: withdrawn while an action still requires it ────
  const arch = await mkDoc({ docNumber: "P1001-30-AR-DSW-00001", title: "Site protection 30 — architectural finish plans, guard houses", deliverableType: "ENG", docType: "DSW", discipline: "AR", assetCodes: ["WT-401"], createdBy: "author2", state: "WITHDRAWN", criticality: "ROUTINE" });
  const archA = await mkRev(arch.id, arch.docNumber, { value: "A", state: "RELEASED", statusCode: "IFI", reason: "Issued for information", change: "Preliminary finishes", releasedAt: d(-35) });
  await mkApproval(archA.id, arch.id, arch.docNumber, "A", "approver");
  await db.document.update({ where: { id: arch.id }, data: { state: "WITHDRAWN" } });
  await db.obsolescenceRecord.create({ data: { projectId, kind: "WITHDRAWN", documentId: arch.id, reason: "Finishes transferred to the contractor's design", authorityName: users.controller.name, createdById: users.controller.id } });
  // still required by action A0007 — OB-14 ▲ / OB-04 ▲ / exposure 4

  // ── 11 · DELIBERATE DEFECT: placeholder holding a revision ─────────────────
  const ph = await mkDoc({ docNumber: "P1001-50-EL-DSW-00002", title: "Non-process building 50 — earthing and lightning protection layout", deliverableType: "ENG", docType: "DSW", discipline: "EL", assetCodes: ["WT-401"], createdBy: "author", isPlaceholder: true, state: "PLANNED", criticality: "QUALITY" });
  await mkRev(ph.id, ph.docNumber, { value: "A", state: "IN_PREPARATION", reason: "First issue", change: "Earthing layout", authorization: "Placeholder register entry (§16.8)" });
  // isPlaceholder should have cleared when the revision was established — RG-16 ▲

  // ── 12 · DELIBERATE DEFECT: generic title + external without received date ──
  const gen = await mkDoc({ docNumber: "P1001-50-PM-REP-00001", title: "Report", deliverableType: "CLT", docType: "REP", discipline: "GE", assetCodes: ["TK-201"], createdBy: "author", criticality: "ROUTINE", receivedDate: null });
  const genA = await mkRev(gen.id, gen.docNumber, { value: "A", state: "RELEASED", statusCode: "IFI", reason: "Issued for information", change: "Client monthly report", releasedAt: d(-8) });
  await mkApproval(genA.id, gen.id, gen.docNumber, "A", "approver");

  // ── 13 · DELIBERATE DEFECT: supersession with no notification issued ───────
  const dat2 = await mkDoc({ docNumber: "P1001-10-BUILDCO-PO102-ME-DAS-00001", title: "Backup feed pump P-102 — datasheet, BuildCo Contracting submittal", deliverableType: "VND", docType: "DAS", discipline: "ME", originator: "BUILDCO", contractRef: "PO102", assetCodes: ["P-102"], createdBy: "vendor", criticality: "QUALITY", receivedDate: d(-30) });
  const dat2A = await mkRev(dat2.id, dat2.docNumber, { value: "A", state: "SUPERSEDED", statusCode: "IFA", reason: "Issued for approval", change: "Pump datasheet, first submittal", releasedAt: d(-28), supersededAt: d(-7) });
  await mkApproval(dat2A.id, dat2.id, dat2.docNumber, "A", "approver");
  const dat2B = await mkRev(dat2.id, dat2.docNumber, { value: "B", state: "RELEASED", statusCode: "AFC", reason: "Comments incorporated", change: "Motor rating corrected to 45 kW", releasedAt: d(-7), authorization: "Review outcome REVISE_AND_RESUBMIT on cycle 1 (§9.3)" });
  await mkApproval(dat2B.id, dat2.id, dat2.docNumber, "B", "approver");
  // no SUPERSEDED notification — OB-05 ▲ / exposure 1

  // ── 14–20 · Clean background register ──────────────────────────────────────
  const clean: DocSeed[] = [
    { docNumber: "P1001-10-CI-DSW-00001", title: "Feed pump bay P-101/P-102 — civil site work drawing", deliverableType: "ENG", docType: "DSW", discipline: "CI", assetCodes: ["P-101"], criticality: "QUALITY", retentionClass: "ASSET_LIFE" },
    { docNumber: "P1001-20-ST-DSW-00001", title: "Clarifier TK-201 — structural foundation drawing", deliverableType: "ENG", docType: "DSW", discipline: "ST", assetCodes: ["TK-201"], criticality: "QUALITY", retentionClass: "ASSET_LIFE" },
    { docNumber: "P1001-40-WW-PRO-00001", title: "Aeration system BL-301 — start-up and shutdown procedure", deliverableType: "ENG", docType: "PRO", discipline: "WW", assetCodes: ["BL-301"], criticality: "SAFETY", retentionClass: "ASSET_LIFE", createdBy: "author2" },
    { docNumber: "P1001-50-ME-CAL-00002", title: "Pump house ventilation — heat emission calculation", deliverableType: "ENG", docType: "CAL", discipline: "ME", assetCodes: ["P-101"], criticality: "ROUTINE" },
    { docNumber: "P1001-60-CI-SPC-00001", title: "Water tower WT-401 — concrete and reinforcement specification", deliverableType: "ENG", docType: "SPC", discipline: "CI", assetCodes: ["WT-401"], criticality: "QUALITY", retentionClass: "ASSET_LIFE", createdBy: "author2" },
    { docNumber: "P1001-50-BUILDCO-PO102-EL-DSW-00001", title: "Pump house — single line diagram, BuildCo Contracting supply scope", deliverableType: "CTR", docType: "DSW", discipline: "EL", originator: "BUILDCO", contractRef: "PO102", assetCodes: ["P-101"], criticality: "QUALITY", receivedDate: d(-18) },
    { docNumber: "P1001-20-CI-REP-00001", title: "Earth works 20 — compaction test results, week 36", deliverableType: "ENG", docType: "REP", discipline: "CI", assetCodes: ["TK-201"], criticality: "QUALITY", retentionClass: "STATUTORY", createdBy: "author2" },
  ];
  for (let i = 0; i < clean.length; i++) {
    const s = clean[i];
    const doc = await mkDoc(s);
    const status = i % 3 === 0 ? "IFC" : i % 3 === 1 ? "AFC" : "IFI";
    const revA = await mkRev(doc.id, doc.docNumber, { value: "A", state: "RELEASED", statusCode: status, reason: "First issue", change: `Initial issue of ${doc.docNumber.split("-").slice(-2).join("-")}`, releasedAt: d(-20 - i) });
    await mkApproval(revA.id, doc.id, doc.docNumber, "A", "approver");
    await mkCycle(revA.id, doc.id, doc.docNumber, "A", { seq: 1, outcome: verdictCode("accept") });
  }

  // ── Transmittals (Part 11) ─────────────────────────────────────────────────
  await db.numberCounter.create({ data: { projectId, prefix: "TR", next: 6 } });
  const mkTransmittal = async (
    number: string, direction: "OUTGOING" | "INCOMING", reason: string, party: string,
    items: { revisionId: string; superseded?: boolean }[],
    recipients: { name: string; organization?: string; userId?: string; opened?: boolean; ack?: boolean }[],
    status: "DRAFT" | "ISSUED" | "ACCEPTED" | "REJECTED",
    issuedDaysAgo: number
  ) => {
    // What it is for and what it carries, as the form would make somebody say.
    const carried = await db.revision.findMany({ where: { id: { in: items.map((i) => i.revisionId) } }, select: { document: { select: { docNumber: true } } } });
    const reasonLabel = (await db.configValue.findFirst({ where: { setKey: "REASONS_FOR_ISSUE", code: reason }, select: { label: true } }))?.label ?? reason;
    const t = await db.transmittal.create({
      data: { projectId,
        subject: subjectFor(reasonLabel, carried.map((one) => one.document.docNumber)),
        number, direction, reasonForIssue: reason, dateOfIssue: d(-issuedDaysAgo),
        issuingParty: party, responseRequired: reason === "REVIEW" || reason === "APPROVAL" || reason === "PRICING",
        responsePeriodDays: reason === "REVIEW" || reason === "APPROVAL" ? 14 : reason === "PRICING" ? 21 : null,
        responseDueDate: reason === "REVIEW" || reason === "APPROVAL" ? d(-issuedDaysAgo + 14) : null,
        status, receivedDate: direction === "INCOMING" ? d(-issuedDaysAgo) : null,
        receivedByParty: direction === "INCOMING" ? "DELIOS" : null,
        createdById: users.controller.id, createdByName: users.controller.name,
        items: { create: items.map((i) => ({ projectId, revisionId: i.revisionId, markedSuperseded: i.superseded ?? false })) },
        recipients: { create: recipients.map((r) => ({ projectId,
          name: r.name,
          organization: r.organization ?? party,
          userId: r.userId ?? null,
          notifiedAt: r.userId ? d(-issuedDaysAgo) : null,
          openedAt: r.opened || r.ack ? d(-issuedDaysAgo + 1) : null,
          lastViewedAt: r.opened || r.ack ? d(-issuedDaysAgo + 1) : null,
          viewCount: r.opened || r.ack ? 1 : 0,
          acknowledgedAt: r.ack ? d(-issuedDaysAgo + 1) : null,
        })) },
      },
    });
    await db.auditEvent.create({ data: { projectId, actorId: users.controller.id, actorName: users.controller.name, action: "TRANSMITTAL_RAISED", entityType: "Transmittal", entityId: t.id, entityLabel: number, detail: `${direction.toLowerCase()} · reason: ${reason} (§11.1).` } });
    return t;
  };

  await mkTransmittal("TR-0001", "OUTGOING", "EXECUTION", "Acme Pumps",
    [{ revisionId: gaB.id }, { revisionId: calcA.id }],
    [{ name: "Acme Pumps Rep", organization: "Acme Pumps", userId: users.vendor.id, opened: true, ack: true }, { name: "A. Bennani (site)", organization: "Acme Pumps", ack: true }],
    "ACCEPTED", 20);

  await mkTransmittal("TR-0002", "INCOMING", "APPROVAL", "Acme Pumps",
    [{ revisionId: (await db.revision.findFirstOrThrow({ where: { documentId: dat.id } })).id }],
    [{ name: "Acme Pumps Rep", organization: "Acme Pumps", userId: users.vendor.id, ack: true }],
    "ISSUED", 1); // awaiting the acceptance check (§11.9) — appears on the dashboard

  await mkTransmittal("TR-0003", "OUTGOING", "INFORMATION", "Softel Systems",
    [{ revisionId: gaA.id }], // superseded, NOT marked — IS-08 ▲ / OB-03 ▲
    [{ name: "R. Fassi (document control)", organization: "Softel Systems", ack: true }],
    "ACCEPTED", 12);

  await mkTransmittal("TR-0004", "OUTGOING", "EXECUTION", "Elec Services",
    [{ revisionId: spcA.id }], // IFR status — execution not permitted — ST-13 ▲
    [{ name: "M. El Hage", organization: "Elec Services", ack: true }],
    "ACCEPTED", 9);

  await mkTransmittal("TR-0005", "OUTGOING", "REVIEW", "BuildCo Contracting",
    [{ revisionId: dat2B.id }],
    [{ name: "BuildCo Contracting Rep", organization: "BuildCo Contracting", userId: users.vendor.id, ack: true }],
    "ACCEPTED", 5);

  // ── Actions & baseline (Part 14) ───────────────────────────────────────────
  const a0007 = await db.action.create({ data: { projectId, code: "A0007", name: "Foundation concrete pour — clarifier TK-201, area 20", scheduledDate: d(-6), ownerName: "Construction manager", scheduleRef: "SCH-REV2-A0007" } });
  const a0031 = await db.action.create({ data: { projectId, code: "A0031", name: "Water tower WT-401 — mechanical completion handover", scheduledDate: d(58), ownerName: "Commissioning lead", scheduleRef: "SCH-REV2-A0031" } });
  const a0044 = await db.action.create({ data: { projectId, code: "A0044", name: "Aeration blower BL-301 — commissioning readiness review", scheduledDate: d(24), ownerName: "Commissioning lead", scheduleRef: "SCH-REV2-A0044", leadTimeDays: 10 } });
  await db.baselineEntry.create({ data: { projectId, actionId: a0007.id, documentId: (await db.document.findFirstOrThrow({ where: { docNumber: "P1001-20-ST-DSW-00001" } })).id, requiredStatus: "IFC", requiredBy: d(-9), createdByName: users.controller.name } });
  await db.baselineEntry.create({ data: { projectId, actionId: a0007.id, documentId: arch.id, requiredStatus: "AFC", requiredBy: d(-9), createdByName: users.controller.name } }); // withdrawn — OB-14 ▲
  await db.baselineEntry.create({ data: { projectId, actionId: a0031.id, documentId: el.id, requiredStatus: "IFC", requiredBy: d(50), createdByName: users.controller.name } });
  await db.baselineEntry.create({ data: { projectId, actionId: a0031.id, documentId: man.id, requiredStatus: "AB", requiredBy: d(50), createdByName: users.controller.name } });
  await db.baselineEntry.create({ data: { projectId, actionId: a0044.id, documentId: spc.id, requiredStatus: "AFC", requiredBy: d(14), createdByName: users.controller.name } });

  const scheduleV1 = await db.scheduleVersion.create({
    data: { projectId,
      sourceName: "Corporate Primavera programme",
      versionLabel: "Baseline 01",
      status: "SUPERSEDED",
      notes: "Approved corporate baseline imported for document-readiness control.",
      importedById: users.controller.id,
      importedByName: users.controller.name,
      publishedAt: d(-30),
      publishedByName: users.controller.name,
      supersededAt: d(-2),
    },
  });
  await db.scheduleActivity.createMany({ data: [
    { projectId, scheduleVersionId: scheduleV1.id, externalId: "P6-1007", actionCode: "A0007", name: a0007.name, baselineDate: d(-10), forecastDate: d(-10), responsibleParty: "Construction", actionId: a0007.id },
    { projectId, scheduleVersionId: scheduleV1.id, externalId: "P6-1031", actionCode: "A0031", name: a0031.name, baselineDate: d(60), forecastDate: d(60), responsibleParty: "Commissioning", actionId: a0031.id },
    { projectId, scheduleVersionId: scheduleV1.id, externalId: "P6-1044", actionCode: "A0044", name: a0044.name, baselineDate: d(20), forecastDate: d(20), responsibleParty: "Commissioning", actionId: a0044.id },
  ] });
  const scheduleV2 = await db.scheduleVersion.create({
    data: { projectId,
      sourceName: "Corporate Primavera programme",
      versionLabel: "Update 02",
      status: "PUBLISHED",
      notes: "Current approved update. A0007 moved 4 days and A0044 moved 4 days.",
      importedById: users.controller.id,
      importedByName: users.controller.name,
      publishedAt: d(-2),
      publishedByName: users.controller.name,
    },
  });
  await db.scheduleActivity.createMany({ data: [
    { projectId, scheduleVersionId: scheduleV2.id, externalId: "P6-1007", actionCode: "A0007", name: a0007.name, baselineDate: d(-10), forecastDate: d(-6), responsibleParty: "Construction", actionId: a0007.id },
    { projectId, scheduleVersionId: scheduleV2.id, externalId: "P6-1031", actionCode: "A0031", name: a0031.name, baselineDate: d(60), forecastDate: d(58), responsibleParty: "Commissioning", actionId: a0031.id },
    { projectId, scheduleVersionId: scheduleV2.id, externalId: "P6-1044", actionCode: "A0044", name: a0044.name, baselineDate: d(20), forecastDate: d(24), responsibleParty: "Commissioning", actionId: a0044.id },
  ] });

  // ── Package (Part 15) ──────────────────────────────────────────────────────
  const pkg = await db.package.create({
    data: { projectId,
      identifier: "PK-001", purpose: "RECORD", type: "DEFINED",
      recipientName: "Riverside Water — Operations handover", completionDate: d(30), requiredStatus: "AB",
      compositionOwnerId: users.author2.id, compositionOwnerName: users.author2.name,
      acceptanceAuthorityId: users.approver.id, acceptanceAuthorityName: users.approver.name,
    },
  });
  await db.packageMember.create({ data: { projectId, packageId: pkg.id, documentId: man.id, requiredStatus: "AB" } });
  await db.packageMember.create({ data: { projectId, packageId: pkg.id, documentId: (await db.document.findFirstOrThrow({ where: { docNumber: "P1001-60-CI-SPC-00001" } })).id, requiredStatus: "AB" } });

  // ── Number counters: put every seeded prefix in the issued-range register ──
  const docs = await db.document.findMany({ select: { docNumber: true, deliverableType: true } });
  const prefixes = new Set<string>();
  for (const doc of docs) {
    const parts = doc.docNumber.split("-");
    if (doc.deliverableType === "CTR" || doc.deliverableType === "VND") prefixes.add(parts.slice(0, 6).join("-"));
    else prefixes.add(parts.slice(0, 4).join("-"));
  }
  for (const prefix of prefixes) {
    await db.numberCounter.upsert({ where: { projectId_prefix: { projectId, prefix } }, update: { next: 20 }, create: { projectId, prefix, next: 20 } });
  }

  // ── Welcome notifications ──────────────────────────────────────────────────
  for (const u of [users.admin, users.controller]) {
    await db.notification.create({
      data: { projectId, userId: u.id, type: "WELCOME", title: "The demo project is seeded", body: "22 documents across every state, live reviews, transmittals — and deliberate defects so the conformance engine shows real findings. Run the checks from the Conformance page.", link: "/conformance" },
    });
  }

  console.log(`· Demo project seeded: ${docs.length} documents, transmittals TR-0001…0005, actions A0007/A0031, package PK-001.`);
  console.log("· Deliberate defects: released-without-approval, blocking comment on released, missing file, unauthorized resubmission, void without reassessment, withdrawn-but-required, placeholder-with-revision, generic title, unnotified supersession, stale copy, bad issues.");
}

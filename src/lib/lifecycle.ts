import type { Tenant } from "./tenant";
import { readFile, writeFile } from "fs/promises";
import path from "path";
import { audit, notify, notifyMany } from "./audit";
import { stampPdf } from "./stamp";
import { UPLOAD_ROOT, readStored, saveBuffer } from "./files";
import type { SessionUser } from "./auth";
import { verdictMeaning, assertMayGiveBindingVerdict, recordApproval } from "./verdict";
import { getActiveSet } from "./config";
import { isAdmin } from "@/lib/auth";
import { holdersOf } from "./permissions";

export { verdictMeaning, assertMayGiveBindingVerdict, recordApproval } from "./verdict";

// ── helpers ──────────────────────────────────────────────────────────────────

export async function executionSeriesStarted(t: Tenant, documentId: string): Promise<boolean> {
  const { db, projectId } = t;
  const count = await db.revision.count({
    where: { documentId, state: { in: ["RELEASED", "SUPERSEDED"] }, statusCode: { not: null } },
  });
  if (!count) return false;
  // An execution-permitting status starts the execution series (§6.2/§7.8)
  const statuses = await getActiveSet("STATUSES");
  const execStatuses = new Set(statuses.filter((s) => s.props.executionFlag === true).map((s) => s.code));
  const revs = await db.revision.findMany({
    where: { documentId, state: { in: ["RELEASED", "SUPERSEDED"] }, statusCode: { not: null } },
    select: { statusCode: true },
  });
  return revs.some((r) => execStatuses.has(r.statusCode!));
}

export async function historicalRecipientsOfRevision(t: Tenant, revisionId: string): Promise<{ userIds: string[]; copyHolders: string[]; docNumber: string; revValue: string }> {
  const { db, projectId } = t;
  const rev = await db.revision.findUniqueOrThrow({
    where: { id: revisionId },
    include: { document: { select: { docNumber: true } } },
  });
  const items = await db.transmittalItem.findMany({
    where: { revisionId },
    include: { transmittal: { include: { recipients: true } } },
  });
  const userIds = items.flatMap((i) => i.transmittal.recipients.map((r) => r.userId).filter((x): x is string => !!x));
  const copies = await db.registeredCopy.findMany({ where: { revisionId }, select: { holder: true } });
  return { userIds, copyHolders: copies.map((c) => c.holder), docNumber: rev.document.docNumber, revValue: rev.value };
}

async function revisionLabel(t: Tenant, revisionId: string) {
  const { db, projectId } = t;
  const rev = await db.revision.findUniqueOrThrow({ where: { id: revisionId }, include: { document: true } });
  return { rev, label: `${rev.document.docNumber} rev ${rev.value}` };
}

/**
 * People allowed to approve/review this document class, most suitable first —
 * the picklist behind "Send for approval" (§8.2 authority matrix).
 */
export async function eligibleApprovers(t: Tenant, document: { discipline: string; docType: string; criticality: string | null }) {
  const approvers = await holdersOf(t, "APPROVE", document);
  const reviewers = await holdersOf(t, "REVIEW", document);
  const byId = new Map<string, { id: string; name: string; role: string; suitable: boolean }>();
  for (const p of reviewers) byId.set(p.id, { id: p.id, name: p.name, role: p.functionName, suitable: false });
  for (const p of approvers) byId.set(p.id, { id: p.id, name: p.name, role: p.functionName, suitable: true });
  return { eligible: [...byId.values()].sort((a, b) => Number(b.suitable) - Number(a.suitable) || a.name.localeCompare(b.name)), minRole: null, matrixVersion: null };
}

// ── Review cycle custody points (§9.1) ───────────────────────────────────────

/** Originator submits: cycle opens at "Submitted". The system, as control function, records receipt. */
export async function openReviewCycle(
  t: Tenant,
  revisionId: string,
  user: SessionUser,
  opts: { mode?: "PARALLEL" | "SERIAL"; reviewerIds: string[]; note?: string; transmittalId?: string | null }
) {
  const { db, projectId } = t;
  const { rev, label } = await revisionLabel(t, revisionId);
  if (rev.state !== "IN_PREPARATION") throw new Error("Only a revision in preparation can be submitted for review.");
  const seq = (await db.reviewCycle.count({ where: { revisionId } })) + 1;
  const mode = opts.mode ?? "PARALLEL";
  const cycle = await db.reviewCycle.create({
    data: { projectId,
      revisionId,
      mode,
      sequence: seq,
      openedById: user.id,
      openedByName: user.name,
      transmittalId: opts.transmittalId ?? null,
      submittedAt: new Date(),
      receivedAt: new Date(), // custody point: received by the control function
      status: "OPEN",
    },
  });
  if (opts.reviewerIds.length) {
    const reviewers = await db.user.findMany({ where: { id: { in: opts.reviewerIds } } });
    await db.reviewAssignment.createMany({
      data: reviewers.map((r, i) => ({ projectId, cycleId: cycle.id, userId: r.id, userName: r.name, order: i + 1 })),
    });
    await notifyMany(
      reviewers.map((r) => r.id),
      "REVIEW_REQUEST",
      `Review requested: ${label}`,
      opts.note ?? "A revision has been issued to you for review.",
      `/reviews/${cycle.id}`, t
    );
  }
  await db.revision.update({ where: { id: revisionId }, data: { state: "IN_REVIEW", issueDate: rev.issueDate ?? new Date() } });
  await audit({
    tenant: t,
    actor: user,
    action: "STATE_TRANSITION",
    entityType: "Revision",
    entityId: revisionId,
    entityLabel: label,
    oldValue: "In preparation",
    newValue: "In review",
    detail: `Review cycle ${seq} opened (submitted → received by control function).`,
  });
  await audit({
    tenant: t,
    actor: user,
    action: "CUSTODY",
    entityType: "ReviewCycle",
    entityId: cycle.id,
    entityLabel: `${label} — cycle ${seq}`,
 detail: "Submitted by originator; received by the control function.",
  });
  return cycle;
}

/** Control function issues the cycle to review (custody point 3). */
export async function issueToReview(t: Tenant, cycleId: string, user: SessionUser) {
  const { db, projectId } = t;
  const cycle = await db.reviewCycle.findUniqueOrThrow({ where: { id: cycleId }, include: { revision: { include: { document: true } }, assignments: true } });
  if (cycle.issuedToReviewAt) throw new Error("Cycle already issued to review.");
  if (!cycle.assignments.length) throw new Error("Assign at least one reviewer before issuing to review.");
  await db.reviewCycle.update({ where: { id: cycleId }, data: { issuedToReviewAt: new Date() } });
  await audit({
    tenant: t,
    actor: user,
    action: "CUSTODY",
    entityType: "ReviewCycle",
    entityId: cycleId,
    entityLabel: `${cycle.revision.document.docNumber} rev ${cycle.revision.value} — cycle ${cycle.sequence}`,
 detail: `Issued to review (${cycle.mode.toLowerCase()}; holder: reviewer).`,
  });
}

/** Reviewer returns from review with the outcome (custody point 4). Outcome is immutable once recorded (§9.4). */
export async function recordReviewOutcome(
  t: Tenant,
  cycleId: string,
  user: SessionUser,
  outcome: string,
  note?: string,
  proposedStatus?: string,
) {
  const { db, projectId } = t;
  const cycle = await db.reviewCycle.findUniqueOrThrow({
    where: { id: cycleId },
    include: { revision: { include: { document: true } }, comments: true, assignments: { orderBy: { order: "asc" } } },
  });
  // §9.7 / B.7.10 — serial review: each reviewer acts on the predecessors' output
  if (cycle.mode === "SERIAL") {
    const mine = cycle.assignments.find((a) => a.userId === user.id);
    if (mine) {
      const before = cycle.assignments.filter((a) => a.order < mine.order);
      const incomplete = before.filter((a) => !a.completedAt);
      if (incomplete.length) {
 throw new Error(`Serial review: ${incomplete.map((a) => a.userName).join(", ")} must complete before you.`);
      }
    }
  }
 if (cycle.outcome) throw new Error("This cycle already carries a recorded outcome — it is immutable.");
  const cons = await verdictMeaning(t, cycle.outcomeSetKey, outcome);
 if (!cons) throw new Error("Outcome is not in the published set.");
  const approves = cycle.binding && cons.proceed && cycle.revision.state === "IN_REVIEW";
  if (approves) {
    await assertMayGiveBindingVerdict(t, cycle.revisionId, user);
    if (!proposedStatus) throw new Error("Say what this revision may be used for once released — “to be IFC”, for instance.");
    const published = await db.configValue.findFirst({ where: { setKey: "STATUSES", code: proposedStatus, status: "ACTIVE" } });
    if (!published) throw new Error(`“${proposedStatus}” is not one of the published statuses.`);
    await db.revision.update({ where: { id: cycle.revisionId }, data: { proposedStatus } });
  }
  if (cycle.issuedToReviewAt) await db.reviewCycle.update({ where: { id: cycleId }, data: { returnedFromReviewAt: new Date() } });
  const blockingOpen = cycle.comments.some((c) => c.progressionPreventing && c.status === "OPEN");
  await db.reviewCycle.update({
    where: { id: cycleId },
    data: { outcome, outcomeAt: new Date(), outcomeByName: user.name, outcomeNote: note ?? null, returnedFromReviewAt: cycle.returnedFromReviewAt ?? new Date() },
  });
  await db.reviewAssignment.updateMany({ where: { cycleId, userId: user.id }, data: { completedAt: new Date() } });
  if (approves) await recordApproval(t, cycle.revisionId, user, `Binding verdict ${cons.code} — ${cons.label}${note ? `: ${note}` : ""}`);
  await audit({
    tenant: t,
    actor: user,
    action: "REVIEW_OUTCOME",
    entityType: "ReviewCycle",
    entityId: cycleId,
    entityLabel: `${cycle.revision.document.docNumber} rev ${cycle.revision.value} — cycle ${cycle.sequence}`,
    newValue: outcome,
 detail: `${cons.label}. ${blockingOpen ? "Progression-preventing comments remain open — work shall not proceed.": ""}`,
  });
  // Notify the control function that the review has returned
  const controllers = await holdersOf(t, "CONTROL");
  await notifyMany(
    controllers.map((c) => c.id),
    "REVIEW_RETURNED",
    `Review returned: ${cycle.revision.document.docNumber} rev ${cycle.revision.value}`,
 `Outcome: ${cons.label}. Return to originator through the control function.`,
    `/reviews/${cycleId}`, t
  );
}

/** Control function returns outcome + comments + authorization to the originator (§9.8, §6.5). */
export async function returnToOriginator(t: Tenant, cycleId: string, user: SessionUser) {
  const { db, projectId } = t;
  const cycle = await db.reviewCycle.findUniqueOrThrow({
    where: { id: cycleId },
    include: { revision: { include: { document: true } }, comments: true },
  });
  if (!cycle.outcome) throw new Error("No outcome recorded for this cycle.");
  if (cycle.returnedToOriginatorAt) throw new Error("Cycle already returned to originator.");
  const cons = (await verdictMeaning(t, cycle.outcomeSetKey, cycle.outcome)) ?? { proceed: false, resubmit: false, label: cycle.outcome };
  await db.reviewCycle.update({ where: { id: cycleId }, data: { returnedToOriginatorAt: new Date(), status: "CLOSED" } });
  // A resubmission-required outcome IS the authorization for the next revision (§6.5, §9.3)
  let authorization = false;
  if (cons.resubmit && cycle.revision.state === "IN_REVIEW") {
    await db.revision.update({
      where: { id: cycle.revisionId },
      data: {
        authorizationReason: `Review outcome "${cons.label}" on cycle ${cycle.sequence}`,
        authorizedById: user.id,
        authorizedByName: user.name,
        authorizedAt: new Date(),
      },
    });
    authorization = true;
  }
  await audit({
    tenant: t,
    actor: user,
    action: "CUSTODY",
    entityType: "ReviewCycle",
    entityId: cycleId,
    entityLabel: `${cycle.revision.document.docNumber} rev ${cycle.revision.value} — cycle ${cycle.sequence}`,
 detail: `Returned to originator via control function; outcome "${cons.label}" issued${authorization ? " with revision authorization": ""}.`,
  });
  await notify(
    cycle.revision.document.createdById,
    "REVIEW_CLOSED",
    `Review outcome for ${cycle.revision.document.docNumber} rev ${cycle.revision.value}`,
    `${cons.label}. ${cons.resubmit ? "Resubmission required — you are authorized to establish the next revision." : "No resubmission required."}`,
    `/documents/${cycle.revision.documentId}`
  );
  return { authorization };
}

// ── Approval & release (Parts 8, 7) ─────────────────────────────────────────

export async function requiredApprovalRole(t: Tenant, document: { discipline: string; docType: string; criticality: string | null }): Promise<{ minRole: string; version: number } | null> {
  const { db, projectId } = t;
  const rows = await db.authorityRow.findMany({ where: { active: true } });
  if (!rows.length) return null; // matrix not published — config finding (SC-03/CL-05)
  const version = Math.max(...rows.map((r) => r.version));
  const specificity = (r: (typeof rows)[number]) =>
    (r.docType === document.docType ? 4 : r.docType == null ? 0 : -1) +
    (r.discipline === document.discipline ? 2 : r.discipline == null ? 0 : -1) +
    (r.criticality === document.criticality ? 1 : r.criticality == null ? 0 : -1);
  const candidates = rows
    .filter(
      (r) =>
        (r.docType == null || r.docType === document.docType) &&
        (r.discipline == null || r.discipline === document.discipline) &&
        (r.criticality == null || r.criticality === document.criticality)
    )
    .map((r) => ({ r, s: specificity(r) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s);
  if (!candidates.length) return null;
  return { minRole: candidates[0].r.minRole, version: candidates[0].r.version };
}

/** Release a revision at a stated status (§7.5–7.6). Supersedes the current revision (§7.5, §12.1). */
export async function releaseRevision(t: Tenant, revisionId: string, user: SessionUser, statusCode: string) {
  // Whatever the caller passes, the status the reviewers decided on wins.
  const { db, projectId } = t;
  const { rev, label } = await revisionLabel(t, revisionId);
  if (rev.proposedStatus) statusCode = rev.proposedStatus;
  if (rev.state !== "IN_REVIEW" && rev.state !== "IN_PREPARATION") throw new Error("Only an in-review revision can be released.");
  const statuses = await getActiveSet("STATUSES");
  const status = statuses.find((s) => s.code === statusCode);
 if (!status) throw new Error("Status is not in the published set.");
  // §8.1 — no release without recorded approval
  const approval = await db.approval.findFirst({ where: { revisionId }, orderBy: { decidedAt: "desc" } });
 if (!approval) throw new Error("Release blocked: no approval is recorded for this revision.");
  // §4.8 — core metadata complete before release
  const doc = rev.document;
  const missing: string[] = [];
  if (!doc.title || /^(report|drawing|layout|document)$/i.test(doc.title.trim())) missing.push("a descriptive title");
  if (!doc.docType) missing.push("document type");
  if (!doc.discipline) missing.push("discipline");
  if (!doc.retentionClass) missing.push("retention class");
  if (!doc.criticality) missing.push("criticality");
  if (!doc.confidentiality) missing.push("confidentiality");
  if (!rev.reasonForRevision) missing.push("reason for revision");
  if (!rev.changeDescription) missing.push("description of change");
 if (!rev.renditionFileId) missing.push("a rendition");
 if (missing.length) throw new Error(`Release blocked — metadata incomplete: ${missing.join(", ")}.`);
  // blocking comments prevent use (§9.6) — but release itself is allowed? §17.3: "released revision with open progression-preventing comment" is a structural contradiction → block release while blocking comments open
  const openBlocking = await db.reviewComment.count({ where: { cycle: { revisionId }, progressionPreventing: true, status: "OPEN" } });
 if (openBlocking > 0) throw new Error(`Release blocked: ${openBlocking} progression-preventing comment(s) still open.`);
  const execFlag = status.props.executionFlag === true;
  const now = new Date();
  let renditionId = rev.renditionFileId;

  // §10.2 — every released revision carries a rendition showing number, revision,
  // status and date; produced here by stamping the uploaded rendition or native PDF.
  try {
    const stampInfo = {
      docNumber: doc.docNumber,
      rev: rev.value,
      statusLabel: status.label,
      date: now,
      state: "RELEASED" as const,
      title: doc.title,
    };
    let source: { buf: Buffer; mime: string } | null = null;
    if (rev.renditionFileId) {
      const row = await db.storedFile.findUniqueOrThrow({ where: { id: rev.renditionFileId } });
      if (row.mime === "application/pdf") source = { buf: await readStored(row.path), mime: row.mime };
      // a non-PDF rendition is kept untouched — it still governs what was issued (§10.3)
    }
    if (!source && rev.nativeFileId) {
      const row = await db.storedFile.findUniqueOrThrow({ where: { id: rev.nativeFileId } });
      if (row.mime === "application/pdf") source = { buf: await readStored(row.path), mime: row.mime };
    }
    if (source) {
      const stamped = await stampPdf(new Uint8Array(source.buf), stampInfo);
      const made = await saveBuffer(t, stamped, doc.docNumber, "RENDITION", rev.value, user.name, user.id);
      await db.storedFile.update({ where: { id: made.id }, data: { revisionId: revisionId } });
      await db.revision.update({ where: { id: revisionId }, data: { renditionFileId: made.id } });
      renditionId = made.id;
    }
  } catch {
    // stamping is best-effort; an uploaded rendition still governs (§10.3)
  }

  // Supersede the current released revision, if any (§7.5)
  const current = await db.revision.findFirst({ where: { documentId: doc.id, state: "RELEASED" } });
  await db.$transaction(async (tx) => {
    await tx.revision.update({
      where: { id: revisionId },
      data: { state: "RELEASED", statusCode, releasedAt: now, releasedById: user.id, releasedByName: user.name, issueDate: rev.issueDate ?? now },
    });
    if (current) {
      await tx.revision.update({ where: { id: current.id }, data: { state: "SUPERSEDED", supersededAt: now, supersededById: user.id } });
      // §12.5 — the superseded rendition becomes visibly marked not-current
      try {
        const oldRenditionId = current.renditionFileId;
        if (oldRenditionId) {
          const row = await tx.storedFile.findUnique({ where: { id: oldRenditionId } });
          if (row && row.mime === "application/pdf") {
            const buf = await readStored(row.path);
            const marked = await stampPdf(new Uint8Array(buf), {
              docNumber: doc.docNumber, rev: current.value, statusLabel: row.name.includes("VOID") ? "Void" : (current.statusCode ?? "Superseded"),
              date: now, state: "SUPERSEDED", title: doc.title,
            });
            const made = await saveBuffer(t, marked, doc.docNumber, "RENDITION", current.value, user.name, user.id);
            await tx.storedFile.update({ where: { id: made.id }, data: { revisionId: current.id } });
            await tx.revision.update({ where: { id: current.id }, data: { renditionFileId: made.id } });
          }
        }
      } catch {
        // marking is best-effort; the superseded rendition remains identifiable by state
      }
      await tx.obsolescenceRecord.create({
        data: { projectId, kind: "SUPERSEDED", documentId: doc.id, revisionId: current.id, reason: `Released ${doc.docNumber} rev ${rev.value} at ${status.label}`, authorityName: user.name, createdById: user.id },
      });
    }
    if (doc.state === "PLANNED") {
      await tx.document.update({ where: { id: doc.id }, data: { state: "ACTIVE", isPlaceholder: false } });
    }
  });
  await audit({
    tenant: t,
    actor: user,
    action: "RELEASE",
    entityType: "Revision",
    entityId: revisionId,
    entityLabel: label,
    newValue: `Released at ${status.code}`,
    detail: `Approved by ${approval.approverName} (matrix v${approval.matrixVersion}).${current ? ` Supersedes rev ${current.value}.` : ""}${execFlag ? " Status permits physical execution." : ""}`,
  });
  if (current) {
    const hist = await historicalRecipientsOfRevision(t, current.id);
    await notifyMany(
      hist.userIds,
      "SUPERSEDED",
      `Superseded: ${doc.docNumber} rev ${current.value}`,
 `A later revision (rev ${rev.value}) was released at ${status.label}. Stop use; recall or mark any controlled copies.`,
      `/documents/${doc.id}`
    , t);
  }
  await notify(doc.createdById, "RELEASED", `Released: ${label}`, `Released at ${status.label}.`, `/documents/${doc.id}`);
  return { superseded: current?.value ?? null, execution: execFlag };
}

// ── Obsolescence (Part 12) ───────────────────────────────────────────────────

export async function voidRevision(t: Tenant, revisionId: string, user: SessionUser, reason: string, reassessment?: string) {
  const { db, projectId } = t;
  const { rev, label } = await revisionLabel(t, revisionId);
  if (rev.state !== "RELEASED") throw new Error("Only a released revision can be voided.");
  // void by decision of the authority that approved it (§7.2)
  const approval = await db.approval.findFirst({ where: { revisionId }, orderBy: { decidedAt: "desc" } });
  const allowed = isAdmin(user) || (approval && approval.approverId === user.id);
 if (!allowed) throw new Error("Voiding is decided by the authority that approved the revision.");
  const now = new Date();
  await db.revision.update({ where: { id: revisionId }, data: { state: "VOID", voidedAt: now, voidReason: reason, voidAuthority: user.name, voidReassessment: reassessment ?? null } });
  try {
    if (rev.renditionFileId) {
      const row = await db.storedFile.findUnique({ where: { id: rev.renditionFileId } });
      if (row && row.mime === "application/pdf") {
        const buf = await readStored(row.path);
        const marked = await stampPdf(new Uint8Array(buf), { docNumber: rev.document.docNumber, rev: rev.value, statusLabel: "Void", date: now, state: "VOID", title: rev.document.title });
        const made = await saveBuffer(t, marked, rev.document.docNumber, "RENDITION", rev.value, user.name, user.id);
        await db.storedFile.update({ where: { id: made.id }, data: { revisionId } });
        await db.revision.update({ where: { id: revisionId }, data: { renditionFileId: made.id } });
      }
    }
  } catch {
    // best-effort marking (§12.5)
  }
  await db.obsolescenceRecord.create({ data: { projectId, kind: "VOID", documentId: rev.documentId, revisionId, reason, authorityName: user.name, createdById: user.id } });
  await audit({ tenant: t, actor: user, action: "STATE_TRANSITION", entityType: "Revision", entityId: revisionId, entityLabel: label, oldValue: "Released", newValue: "Void", detail: reason });
  const hist = await historicalRecipientsOfRevision(t, revisionId);
 await notifyMany(hist.userIds, "VOID", `Void: ${label}`, `Issued in error: ${reason}. Stop use and reassess work performed under it.`, `/documents/${rev.documentId}`, t);
}

export async function endDocumentState(t: Tenant, docId: string, user: SessionUser, kind: "WITHDRAWN" | "CANCELLED" | "ARCHIVED", reason: string) {
  const { db, projectId } = t;
  const doc = await db.document.findUniqueOrThrow({ where: { id: docId } });
  if (doc.state === kind) throw new Error(`Document is already ${kind.toLowerCase()}.`);
  if (kind === "CANCELLED" && (await db.revision.count({ where: { documentId: docId, state: { in: ["RELEASED", "SUPERSEDED"] } } })) > 0) {
 throw new Error("Cannot cancel: a revision was released. Withdraw it instead.");
  }
  await db.document.update({ where: { id: docId }, data: { state: kind } });
  await db.obsolescenceRecord.create({ data: { projectId, kind, documentId: docId, reason, authorityName: user.name, createdById: user.id } });
  await audit({ tenant: t, actor: user, action: "STATE_TRANSITION", entityType: "Document", entityId: docId, entityLabel: doc.docNumber, oldValue: doc.state, newValue: kind, detail: reason });
  // notify everyone who ever received any of its revisions (§12.3)
  const items = await db.transmittalItem.findMany({ where: { revision: { documentId: docId } }, include: { transmittal: { include: { recipients: true } } } });
  const userIds = items.flatMap((i) => i.transmittal.recipients.map((r) => r.userId).filter((x): x is string => !!x));
  await notifyMany(userIds, kind, `${kind === "WITHDRAWN" ? "Withdrawn" : kind === "CANCELLED" ? "Cancelled" : "Archived"}: ${doc.docNumber}`, reason, `/documents/${docId}`, t);
}

// ── Issue gates (§11.3 / B.8.2) ─────────────────────────────────────────────

/** What may be issued: only Released revisions; superseded only on historical request, marked as such. */
export function issueGateError(revState: string, markedSuperseded: boolean): string | null {
  if (revState === "RELEASED") return null;
 if (revState === "SUPERSEDED") return markedSuperseded ? null: "A superseded revision may only be issued on specific historical request and must be marked as superseded.";
 return "Only released revisions may be issued.";
}

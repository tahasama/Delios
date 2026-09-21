"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/scope";
import { isController, isAdmin } from "@/lib/auth";
import { audit, notify } from "@/lib/audit";
import { isReadOnly } from "@/lib/auth";

// ── §2.2–2.4 Records: confirmed, fixed, never revised; corrections are new records ──

export async function confirmRecordAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  if (isReadOnly(user)) return { error: "Viewers cannot confirm records." };
  const documentId = String(formData.get("documentId") ?? "");
  const doc = await db.document.findUniqueOrThrow({ where: { id: documentId } });
  if (doc.kind !== "RECORD") return { error: "Only a record is confirmed (§2.2)." };
  if (doc.state !== "PLANNED") return { error: "Already confirmed." };
  await db.document.update({ where: { id: documentId }, data: { state: "ACTIVE", confirmedAt: new Date(), confirmedByName: user.name } });
  await audit({ actor: user, action: "RECORD_CONFIRMED", entityType: "Document", entityId: documentId, entityLabel: doc.docNumber, detail: "Record confirmed — fixed as evidence; never revised (§2.2). Corrections issue a further record referencing this one (§2.3)." });
  revalidatePath(`/documents/${documentId}`);
  return {};
}

/** §2.3 — a correction is a NEW record referencing the record corrected; both retained. */
export async function correctRecordAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  if (isReadOnly(user)) return { error: "Viewers cannot issue corrections." };
  const originalId = String(formData.get("documentId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "The correction needs its own descriptive title." };
  const original = await db.document.findUniqueOrThrow({ where: { id: originalId } });

  // same identity scheme, next sequence
  const parts = original.docNumber.split("-");
  const prefix = parts.slice(0, -1).join("-");
  const last = parseInt(parts[parts.length - 1], 10) || 0;
  let docNumber = `${prefix}-${String(last + 1).padStart(parts[parts.length - 1].length, "0")}`;
  let bump = last + 1;
  while (await db.document.findFirst({ where: { docNumber } })) {
    bump++;
    docNumber = `${prefix}-${String(bump).padStart(parts[parts.length - 1].length, "0")}`;
  }

  const correction = await db.document.create({
    data: {
      projectId,
      docNumber,
      title,
      deliverableType: original.deliverableType,
      docType: original.docType,
      discipline: original.discipline,
      originator: original.originator,
      subProject: original.subProject,
      contractRef: original.contractRef,
      criticality: original.criticality,
      confidentiality: original.confidentiality,
      retentionClass: original.retentionClass,
      kind: "RECORD",
      state: "PLANNED",
      createdById: user.id,
      createdByName: user.name,
      receivedDate: original.receivedDate,
    },
  });
  await db.relationship.create({
    data: { projectId, kind: "RECORD_CORRECTION", fromType: "Document", fromId: correction.id, toType: "Document", toId: original.id, note: `Corrects ${original.docNumber} (§2.3)`, createdById: user.id },
  });
  await audit({ actor: user, action: "REGISTER_ENTRY", entityType: "Document", entityId: correction.id, entityLabel: docNumber, detail: `Correction of record ${original.docNumber} — both retained; the original is never altered (§2.3).` });
  revalidatePath(`/documents/${originalId}`);
  return {};
}

// ── §8.7 Withdrawal of approval ─────────────────────────────────────────────

export async function withdrawApprovalAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  const revisionId = String(formData.get("revisionId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { error: "A withdrawal is recorded with its reason (§8.7)." };
  const approval = await db.approval.findFirst({ where: { revisionId, withdrawnAt: null }, orderBy: { decidedAt: "desc" } });
  if (!approval) return { error: "No live approval to withdraw." };
  const allowed = isAdmin(user) || approval.approverId === user.id;
  if (!allowed) return { error: "Only the approving authority (or an administrator) withdraws an approval (§8.7)." };

  const rev = await db.revision.findUniqueOrThrow({ where: { id: revisionId }, include: { document: true } });
  await db.approval.update({ where: { id: approval.id }, data: { withdrawnAt: new Date(), withdrawnBy: user.name, withdrawnReason: reason } });
  // the document enters Withdrawn until a replacement is released (§8.7)
  await db.document.update({ where: { id: rev.documentId }, data: { state: "WITHDRAWN" } });
  await db.obsolescenceRecord.create({ data: { projectId, kind: "WITHDRAWN", documentId: rev.documentId, revisionId, reason: `Approval withdrawn: ${reason}`, authorityName: user.name, createdById: user.id } });
  await audit({ actor: user, action: "APPROVAL_WITHDRAWN", entityType: "Revision", entityId: revisionId, entityLabel: `${rev.document.docNumber} rev ${rev.value}`, detail: `${reason} — original approval retained; document withdrawn until a replacement is released (§8.7 / AP-13).` });
  await notify(rev.document.createdById, "WITHDRAWN", `Approval withdrawn: ${rev.document.docNumber} rev ${rev.value}`, reason, `/documents/${rev.documentId}`);
  revalidatePath(`/documents/${rev.documentId}`);
  return {};
}

// ── §9.6 Reclassification: the executing party may force it ────────────────

export async function reclassifyCommentAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  if (isReadOnly(user)) return { error: "Viewers cannot reclassify." };
  const commentId = String(formData.get("commentId") ?? "");
  const cycleId = String(formData.get("cycleId") ?? "");
  const prevent = formData.get("prevent") === "on";
  const note = String(formData.get("note") ?? "").trim();
  const comment = await db.reviewComment.findUniqueOrThrow({ where: { id: commentId } });
  await db.reviewComment.update({
    where: { id: commentId },
    data: {
      progressionPreventing: prevent,
      originalProgressionPreventing: comment.originalProgressionPreventing ?? comment.progressionPreventing,
      reclassifiedAt: new Date(),
      reclassifiedByName: user.name,
      classification: prevent ? "BLOCKING" : "NON_BLOCKING",
    },
  });
  await audit({
    actor: user,
    action: "COMMENT_RECLASSIFIED",
    entityType: "ReviewComment",
    entityId: commentId,
    oldValue: comment.progressionPreventing ? "prevents progression" : "non-preventing",
    newValue: prevent ? "prevents progression" : "non-preventing",
    detail: note || `Reclassified by ${user.name} (§9.6 — the executing party may force reclassification).`,
  });
  revalidatePath(`/reviews/${cycleId}`);
  return {};
}

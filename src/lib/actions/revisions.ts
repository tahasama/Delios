"use server";

import { startWorkflowRun } from "@/lib/workflow";
import { redirect } from "next/navigation";
import { requireScope } from "@/lib/scope";
import { revalidatePath } from "next/cache";
import { isController, isAdmin, mayContributeToDocument } from "@/lib/auth";
import { audit, notifyMany } from "@/lib/audit";
import { saveUpload } from "@/lib/files";
import { parseSteps, recordStepOutcome } from "@/lib/workflow";
import { executionSeriesStarted, openReviewCycle, recordReviewOutcome, returnToOriginator, issueToReview, recordApproval, releaseRevision, voidRevision } from "@/lib/lifecycle";
import { enforce } from "@/lib/rules/preflight";
import { nextRevisionValue } from "@/lib/numbering";
import { getActiveSet } from "@/lib/config";
import { isReadOnly } from "@/lib/auth";
import { holdersOf } from "@/lib/permissions";

// G.3 steps 1–5 — establish a revision: authorization first (§6.5), one in
// preparation at a time (§6.3), next value in the applicable series (§6.2).
export async function prepareRevisionAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  const documentId = String(formData.get("documentId") ?? "");
  const reasonForRevision = String(formData.get("reasonForRevision") ?? "").trim();
  const changeDescription = String(formData.get("changeDescription") ?? "").trim();
  const plannedSubmissionDate = String(formData.get("plannedSubmissionDate") ?? "") || null;
  const phase = String(formData.get("phase") ?? "") || null;
  const explicitAuth = String(formData.get("authorizationReason") ?? "").trim();

  const doc = await db.document.findUniqueOrThrow({ where: { id: documentId } });
  if (!mayContributeToDocument(user, doc)) return { error: "You may prepare revisions only for documents assigned to your organization." };
  try {
    await enforce("CREATE_REVISION", { documentId }, ctx);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Cannot start a revision." };
  }
 if (!reasonForRevision) return { error: "Reason for revision is required." };
 if (!changeDescription) return { error: "Description of change is required — it says what changed; it does not restate the reason." };

  const inPrep = await db.revision.findFirst({ where: { documentId, state: "IN_PREPARATION" } });
 if (inPrep) return { error: `Rev ${inPrep.value} is already in preparation — max one per document.` };

  const isPlaceholder = doc.isPlaceholder;
  const lastRev = await db.revision.findFirst({ where: { documentId }, orderBy: { createdAt: "desc" } });

  let authorizationReason: string | null = null;
  let authorizedById: string | null = null;
  let authorizedByName: string | null = null;
  let authorizedAt: Date | null = null;

  if (isPlaceholder) {
    // Placeholder creation IS the authorization for the first revision (§6.5).
 authorizationReason = "Placeholder register entry — authorization for the first revision.";
    authorizedById = user.id;
    authorizedByName = user.name;
    authorizedAt = new Date();
  } else {
    // A review outcome requiring resubmission is itself the authorization (§9.3/§6.5)
    const outcome = lastRev
      ? await db.reviewCycle.findFirst({
          where: { revisionId: lastRev.id, outcome: { in: ["REVISE_AND_RESUBMIT", "APPROVED_WITH_COMMENTS", "REJECTED"] }, returnedToOriginatorAt: { not: null } },
          orderBy: { outcomeAt: "desc" },
        })
      : null;
    if (outcome) {
 authorizationReason = `Review outcome "${outcome.outcome}" on cycle ${outcome.sequence}`;
      authorizedById = user.id;
      authorizedByName = user.name;
      authorizedAt = new Date();
    } else if (explicitAuth) {
      if (!isController(user) && !isAdmin(user)) {
 return { error: "Authorization to revise is issued by the designated control function — no party establishes a revision without it." };
      }
      authorizationReason = explicitAuth;
      authorizedById = user.id;
      authorizedByName = user.name;
      authorizedAt = new Date();
    } else {
 return { error: "No revision may be established without prior authorization. The control function states the reason explicitly." };
    }
  }

  const series = isPlaceholder || !(await executionSeriesStarted(ctx, documentId)) ? "DESIGN" : "EXECUTION";
  const existing = await db.revision.findMany({ where: { documentId }, select: { value: true } });
  const scope = await db.scopeConfig.findFirst();
  const value = nextRevisionValue(series as "DESIGN" | "EXECUTION", existing.map((e) => e.value), scope?.executionSeriesStart ?? 0);

  const rev = await db.revision.create({
    data: { projectId,
      documentId,
      value,
      series,
      state: "IN_PREPARATION",
      reasonForRevision,
      changeDescription,
      plannedSubmissionDate: plannedSubmissionDate ? new Date(plannedSubmissionDate) : null,
      phase,
      authorizationReason,
      authorizedById,
      authorizedByName,
      authorizedAt,
    },
  });
  if (isPlaceholder) await db.document.update({ where: { id: documentId }, data: { isPlaceholder: false } });
  await audit({
    actor: user,
    action: "REVISION_ESTABLISHED",
    entityType: "Revision",
    entityId: rev.id,
    entityLabel: `${doc.docNumber} rev ${value}`,
    detail: `Series ${series.toLowerCase()}; authorization: ${authorizationReason}`,
  });

  // The received file and the send can come with the new revision, so a
  // resubmission is one form rather than three.
  const upload = formData.get("revisionFile") as File | null;
  if (upload && upload.size > 0) {
    const isPdf = upload.type === "application/pdf" || upload.name.toLowerCase().endsWith(".pdf");
    const fileKind = isPdf ? "RENDITION" : "NATIVE";
    const saved = await saveUpload(ctx, upload, doc.docNumber, fileKind, value);
    const file = await db.storedFile.create({ data: { projectId, path: saved.relPath, name: saved.name, size: saved.size, mime: saved.mime, sha256: saved.sha256, kind: fileKind, revisionId: rev.id, uploadedById: user.id, uploadedByName: user.name } });
    await db.revision.update({ where: { id: rev.id }, data: isPdf ? { renditionFileId: file.id } : { nativeFileId: file.id } });
    await audit({ actor: user, action: "FILE_UPLOADED", entityType: "Revision", entityId: rev.id, entityLabel: `${doc.docNumber} rev ${value}`, newValue: saved.name });
    const templateId = String(formData.get("sendTemplateId") ?? "");
    if (templateId) {
      const res = await startWorkflowRun(ctx, rev.id, templateId, user);
      if (!res.ok) {
        revalidatePath(`/documents/${documentId}`);
        return { error: `Rev ${value} was created but not sent: ${res.error}` };
      }
    }
  }
  revalidatePath(`/documents/${documentId}`);
  return {};
}

export async function uploadRevisionFilesAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  if (isReadOnly(user)) return { error: "Viewers cannot upload files." };
  const revisionId = String(formData.get("revisionId") ?? "");
  const native = formData.get("nativeFile") as File | null;
  const rendition = formData.get("renditionFile") as File | null;
  const appVersion = String(formData.get("appVersion") ?? "") || null;
  const rev = await db.revision.findUniqueOrThrow({ where: { id: revisionId }, include: { document: true } });
  if (!mayContributeToDocument(user, rev.document)) return { error: "You may upload files only for documents assigned to your organization." };
  if (rev.state === "RELEASED" || rev.state === "SUPERSEDED" || rev.state === "VOID") return { error: "This revision is closed — files belong to a revision in preparation or in review." };

  try {
    if (native && native.size > 0) {
      const saved = await saveUpload(ctx, native, rev.document.docNumber, "NATIVE", rev.value);
      const file = await db.storedFile.create({ data: { projectId, path: saved.relPath, name: saved.name, size: saved.size, mime: saved.mime, sha256: saved.sha256, kind: "NATIVE", revisionId, uploadedById: user.id, uploadedByName: user.name } });
      await db.revision.update({ where: { id: revisionId }, data: { nativeFileId: file.id, appVersion: appVersion ?? rev.appVersion } });
 await audit({ actor: user, action: "FILE_UPLOADED", entityType: "Revision", entityId: revisionId, entityLabel: `${rev.document.docNumber} rev ${rev.value}`, newValue: saved.name, detail: "Native form retained." });
    }
    if (rendition && rendition.size > 0) {
      const saved = await saveUpload(ctx, rendition, rev.document.docNumber, "RENDITION", rev.value);
      const file = await db.storedFile.create({ data: { projectId, path: saved.relPath, name: saved.name, size: saved.size, mime: saved.mime, sha256: saved.sha256, kind: "RENDITION", revisionId, uploadedById: user.id, uploadedByName: user.name } });
      await db.revision.update({ where: { id: revisionId }, data: { renditionFileId: file.id } });
 await audit({ actor: user, action: "FILE_UPLOADED", entityType: "Revision", entityId: revisionId, entityLabel: `${rev.document.docNumber} rev ${rev.value}`, newValue: saved.name, detail: "Rendition produced." });
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Upload failed." };
  }
  if ((!native || native.size === 0) && (!rendition || rendition.size === 0)) return { error: "Choose at least one file." };
  revalidatePath(`/documents/${rev.documentId}`);
  return {};
}


export async function issueToReviewAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
 if (!isController(user) && !isAdmin(user)) return { error: "The control function issues cycles to review." };
  const cycleId = String(formData.get("cycleId") ?? "");
  try {
    await issueToReview(ctx, cycleId, user);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not issue to review." };
  }
  revalidatePath(`/reviews/${cycleId}`);
  return {};
}

export async function addCommentAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  const cycleId = String(formData.get("cycleId") ?? "");
  const assigned = await db.reviewAssignment.findFirst({ where: { cycleId, userId: user.id } });
  if (!assigned && !isController(user) && !isAdmin(user)) return { error: "You may comment only on a review assigned to you." };
  const text = String(formData.get("text") ?? "").trim();
  // One question, asked once: does this comment stop the release? The published
  // classification is still what gets stored, so the register is unchanged.
  const blocking = formData.get("blocking") === "on";
  const classes = await getActiveSet("COMMENT_CLASSES");
  const classification = classes.find((c) => (c.props.progressionPreventing === true) === blocking)?.code
    ?? (blocking ? "BLOCKING" : "NON_BLOCKING");
  if (!text) return { error: "Comment text is required." };
  await db.reviewComment.create({
    data: { projectId, cycleId, authorId: user.id, authorName: user.name, text, classification, progressionPreventing: blocking },
  });
  await audit({
    actor: user,
    action: "REVIEW_COMMENT",
    entityType: "ReviewCycle",
    entityId: cycleId,
 detail: `${blocking ? "Progression-preventing": "Non-preventing"} comment recorded.`,
  });
  revalidatePath(`/reviews/${cycleId}`);
  return {};
}

/** Close a progression-preventing comment — only with a recorded resolution (§9.6). */
export async function closeCommentAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  const commentId = String(formData.get("commentId") ?? "");
  const comment = await db.reviewComment.findUniqueOrThrow({ where: { id: commentId } });
  const assigned = await db.reviewAssignment.findFirst({ where: { cycleId: comment.cycleId, userId: user.id } });
  if (comment.authorId !== user.id && !assigned && !isController(user) && !isAdmin(user)) {
 return { error: "Only the comment author, an assigned reviewer or the control function closes comments." };
  }
  const cycleId = String(formData.get("cycleId") ?? "");
  const resolution = String(formData.get("resolution") ?? "").trim();
 if (!resolution) return { error: "A progression-preventing comment is closed only with a recorded resolution." };
  await db.reviewComment.update({ where: { id: commentId }, data: { status: "CLOSED", resolution, closedAt: new Date() } });
  await audit({ actor: user, action: "COMMENT_CLOSED", entityType: "ReviewComment", entityId: commentId, newValue: resolution });
  revalidatePath(`/reviews/${cycleId}`);
  return {};
}

export async function recordOutcomeAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  const cycleId = String(formData.get("cycleId") ?? "");
  const outcome = String(formData.get("outcome") ?? "");
  const note = String(formData.get("outcomeNote") ?? "") || undefined;
  const proposedStatus = String(formData.get("proposedStatus") ?? "").trim() || undefined;
  try {
    await enforce("RECORD_OUTCOME", { cycleId, outcomeCode: outcome }, ctx);
    // A cycle that belongs to a review route is decided through the route, so
    // the route advances, returns or completes — there is one way to decide.
    const cycle = await db.reviewCycle.findUniqueOrThrow({ where: { id: cycleId }, select: { revisionId: true } });
    const runs = await db.workflowRun.findMany({ where: { revisionId: cycle.revisionId } });
    const run = runs.find((r) => parseSteps(r.steps).some((s) => s.cycleId === cycleId));
    if (run) {
      const current = parseSteps(run.steps)[run.currentStep];
      if (run.status !== "ACTIVE" || current?.cycleId !== cycleId) return { error: "This step of the review route is closed." };
      const res = await recordStepOutcome(ctx, run.id, user, outcome, note, proposedStatus);
      if (!res.ok) return { error: res.error };
    } else {
      await recordReviewOutcome(ctx, cycleId, user, outcome, note, proposedStatus);
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not record outcome." };
  }
  revalidatePath(`/reviews/${cycleId}`);
  revalidatePath("/");
  return {};
}

export async function returnToOriginatorAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
 if (!isController(user) && !isAdmin(user)) return { error: "An outcome shall not pass directly from reviewer to originator — the control function returns it." };
  const cycleId = String(formData.get("cycleId") ?? "");
  try {
    await returnToOriginator(ctx, cycleId, user);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not return to originator." };
  }
  revalidatePath(`/reviews/${cycleId}`);
  return {};
}


// G.1 steps 11–13 — release at a status (§7.6), superseding the current revision (§7.5)
export async function releaseRevisionAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  const revisionId = String(formData.get("revisionId") ?? "");
  const statusCode = String(formData.get("statusCode") ?? "");
 if (!statusCode) return { error: "Choose the status the revision is released at." };
  let result;
  try {
    await enforce("RELEASE", { revisionId, statusCode }, ctx);
    result = await releaseRevision(ctx, revisionId, user, statusCode);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Release blocked." };
  }
  const rev = await db.revision.findUniqueOrThrow({ where: { id: revisionId } });
  revalidatePath(`/documents/${rev.documentId}`);
  redirect(`/documents/${rev.documentId}?released=1&superseded=${result.superseded ?? ""}`);
}

// §7.2 — void, by decision of the authority that approved it
export async function voidRevisionAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  const revisionId = String(formData.get("revisionId") ?? "");
  const reason = String(formData.get("voidReason") ?? "").trim();
  const reassessment = String(formData.get("reassessment") ?? "").trim() || undefined;
 if (!reason) return { error: "Voiding is recorded with a reason." };
  try {
    await enforce("VOID", { revisionId }, ctx);
    await voidRevision(ctx, revisionId, user, reason, reassessment);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not void." };
  }
  const rev = await db.revision.findUniqueOrThrow({ where: { id: revisionId } });
  revalidatePath(`/documents/${rev.documentId}`);
  return {};
}

/** §12.6 — record the reassessment of work performed under a voided revision. */
export async function recordVoidReassessmentAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  if (!isController(user) && !isAdmin(user)) return { error: "Only the control function records reassessment." };
  const revisionId = String(formData.get("revisionId") ?? "");
  const note = String(formData.get("note") ?? "").trim();
 if (!note) return { error: "Describe the reassessment of work performed." };
  await db.revision.update({ where: { id: revisionId }, data: { voidReassessment: note } });
 await audit({ actor: user, action: "STATE_TRANSITION", entityType: "Revision", entityId: revisionId, detail: "Void reassessment recorded." });
  revalidatePath("/exposures");
  return {};
}





"use server";

import { startWorkflowRun } from "@/lib/workflow";
import { redirect } from "next/navigation";
import { requireScope } from "@/lib/scope";
import { revalidatePath } from "next/cache";
import { isController, isAdmin, mayContributeToDocument } from "@/lib/auth";
import { audit, notifyMany } from "@/lib/audit";
import { saveUpload } from "@/lib/files";
import { executionSeriesStarted, openReviewCycle, recordReviewOutcome, returnToOriginator, issueToReview, recordApproval, releaseRevision, voidRevision } from "@/lib/lifecycle";
import { enforce } from "@/lib/rules/preflight";
import { nextRevisionValue } from "@/lib/numbering";
import { getActiveSet } from "@/lib/config";

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
  if (!reasonForRevision) return { error: "Reason for revision is required (§6.6)." };
  if (!changeDescription) return { error: "Description of change is required — it says what changed; it does not restate the reason (§6.6)." };

  const inPrep = await db.revision.findFirst({ where: { documentId, state: "IN_PREPARATION" } });
  if (inPrep) return { error: `Rev ${inPrep.value} is already in preparation — max one per document (§6.3).` };

  const isPlaceholder = doc.isPlaceholder;
  const lastRev = await db.revision.findFirst({ where: { documentId }, orderBy: { createdAt: "desc" } });

  let authorizationReason: string | null = null;
  let authorizedById: string | null = null;
  let authorizedByName: string | null = null;
  let authorizedAt: Date | null = null;

  if (isPlaceholder) {
    // Placeholder creation IS the authorization for the first revision (§6.5).
    authorizationReason = "Placeholder register entry (§16.8) — authorization for the first revision.";
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
      authorizationReason = `Review outcome "${outcome.outcome}" on cycle ${outcome.sequence} (§9.3)`;
      authorizedById = user.id;
      authorizedByName = user.name;
      authorizedAt = new Date();
    } else if (explicitAuth) {
      if (!isController(user) && !isAdmin(user)) {
        return { error: "Authorization to revise is issued by the designated control function — no party establishes a revision without it (§6.5)." };
      }
      authorizationReason = explicitAuth;
      authorizedById = user.id;
      authorizedByName = user.name;
      authorizedAt = new Date();
    } else {
      return { error: "No revision may be established without prior authorization (§6.5). The control function states the reason explicitly." };
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
  if (user.role === "VIEWER") return { error: "Viewers cannot upload files." };
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
      await audit({ actor: user, action: "FILE_UPLOADED", entityType: "Revision", entityId: revisionId, entityLabel: `${rev.document.docNumber} rev ${rev.value}`, newValue: saved.name, detail: "Native form retained (§10.1)." });
    }
    if (rendition && rendition.size > 0) {
      const saved = await saveUpload(ctx, rendition, rev.document.docNumber, "RENDITION", rev.value);
      const file = await db.storedFile.create({ data: { projectId, path: saved.relPath, name: saved.name, size: saved.size, mime: saved.mime, sha256: saved.sha256, kind: "RENDITION", revisionId, uploadedById: user.id, uploadedByName: user.name } });
      await db.revision.update({ where: { id: revisionId }, data: { renditionFileId: file.id } });
      await audit({ actor: user, action: "FILE_UPLOADED", entityType: "Revision", entityId: revisionId, entityLabel: `${rev.document.docNumber} rev ${rev.value}`, newValue: saved.name, detail: "Rendition produced (§10.2)." });
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Upload failed." };
  }
  if ((!native || native.size === 0) && (!rendition || rendition.size === 0)) return { error: "Choose at least one file." };
  revalidatePath(`/documents/${rev.documentId}`);
  return {};
}

// G.1 step 9 — submit for review (or for approval where no review applies)
export async function submitForReviewAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  const revisionId = String(formData.get("revisionId") ?? "");
  const mode = String(formData.get("mode") ?? "PARALLEL") as "PARALLEL" | "SERIAL";
  const note = String(formData.get("note") ?? "") || undefined;
  const reviewerIds = formData.getAll("reviewerIds").map(String).filter(Boolean);
  if (!reviewerIds.length) return { error: "Select at least one reviewer — the control function issues the cycle to review (§9.1)." };

  const source = await db.revision.findUnique({ where: { id: revisionId }, include: { document: true } });
  if (!source) return { error: "Revision not found." };
  if (!mayContributeToDocument(user, source.document)) return { error: "You may submit only documents assigned to your organization." };

  try {
    await enforce("SUBMIT_FOR_REVIEW", { revisionId }, ctx);
    await openReviewCycle(ctx, revisionId, user, { mode, reviewerIds, note });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not submit." };
  }
  const rev = await db.revision.findUniqueOrThrow({ where: { id: revisionId } });
  revalidatePath(`/documents/${rev.documentId}`);
  redirect(`/documents/${rev.documentId}`);
}

export async function issueToReviewAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  if (!isController(user) && !isAdmin(user)) return { error: "The control function issues cycles to review (§9.1)." };
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
  const classification = String(formData.get("classification") ?? "NON_BLOCKING");
  const classes = await getActiveSet("COMMENT_CLASSES");
  const cls = classes.find((c) => c.code === classification);
  const blocking = cls?.props.progressionPreventing === true;
  if (!text) return { error: "Comment text is required." };
  await db.reviewComment.create({
    data: { projectId, cycleId, authorId: user.id, authorName: user.name, text, classification, progressionPreventing: blocking },
  });
  await audit({
    actor: user,
    action: "REVIEW_COMMENT",
    entityType: "ReviewCycle",
    entityId: cycleId,
    detail: `${blocking ? "Progression-preventing" : "Non-preventing"} comment recorded (§9.6).`,
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
    return { error: "Only the comment author, an assigned reviewer or the control function closes comments (§9.6)." };
  }
  const cycleId = String(formData.get("cycleId") ?? "");
  const resolution = String(formData.get("resolution") ?? "").trim();
  if (!resolution) return { error: "A progression-preventing comment is closed only with a recorded resolution (§9.6)." };
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
  try {
    await enforce("RECORD_OUTCOME", { cycleId, outcomeCode: outcome }, ctx);
    await recordReviewOutcome(ctx, cycleId, user, outcome, note);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not record outcome." };
  }
  revalidatePath(`/reviews/${cycleId}`);
  return {};
}

export async function returnToOriginatorAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  if (!isController(user) && !isAdmin(user)) return { error: "An outcome shall not pass directly from reviewer to originator — the control function returns it (§9.8)." };
  const cycleId = String(formData.get("cycleId") ?? "");
  try {
    await returnToOriginator(ctx, cycleId, user);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not return to originator." };
  }
  revalidatePath(`/reviews/${cycleId}`);
  return {};
}

// Part 8 — approval by a named individual holding authority (§8.3)
export async function approveRevisionAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  const revisionId = String(formData.get("revisionId") ?? "");
  const note = String(formData.get("note") ?? "") || undefined;
  try {
    // The same checklist the screen showed, asked again at the moment of the
    // act — so the refusal reads exactly as the preview did.
    await enforce("APPROVE", { revisionId }, ctx);
    await recordApproval(ctx, revisionId, user, note);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Approval rejected." };
  }
  const rev = await db.revision.findUniqueOrThrow({ where: { id: revisionId } });
  revalidatePath(`/documents/${rev.documentId}`);
  return {};
}

// G.1 steps 11–13 — release at a status (§7.6), superseding the current revision (§7.5)
export async function releaseRevisionAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  const revisionId = String(formData.get("revisionId") ?? "");
  const statusCode = String(formData.get("statusCode") ?? "");
  if (!statusCode) return { error: "Choose the status the revision is released at (§7.6)." };
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
  if (!reason) return { error: "Voiding is recorded with a reason (§12.1)." };
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
  if (!note) return { error: "Describe the reassessment of work performed (§12.6)." };
  await db.revision.update({ where: { id: revisionId }, data: { voidReassessment: note } });
  await audit({ actor: user, action: "STATE_TRANSITION", entityType: "Revision", entityId: revisionId, detail: "Void reassessment recorded (§12.6)." });
  revalidatePath("/exposures");
  return {};
}

// ── The approval journey: one decision, two buttons ─────────────────────────

/**
 * Approve or request changes from a single screen (dashboard / decision page).
 * Approve → records the approval (authority checked, §8.3).
 * Request changes → records a progression-preventing comment + the published
 * "Revise and resubmit" outcome, then returns the cycle through the control
 * function path so the author receives outcome + authorization (§9.3, §9.8).
 */
export async function quickDecisionAction(_prev: { error?: string; ok?: string } | undefined, formData: FormData): Promise<{ error?: string; ok?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  const revisionId = String(formData.get("revisionId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  const cycleId = String(formData.get("cycleId") ?? "") || null;

  const rev = await db.revision.findUniqueOrThrow({ where: { id: revisionId }, include: { document: true } });
  const label = `${rev.document.docNumber} rev ${rev.value}`;

  if (decision === "approve") {
    if (!cycleId && rev.state !== "IN_REVIEW") return { error: `${label} is not awaiting a decision.` };
    if (cycleId) {
      const cycle = await db.reviewCycle.findUniqueOrThrow({ where: { id: cycleId } });
      if (cycle.outcome) {
        await recordApproval(ctx, revisionId, user, note || undefined);
        revalidatePath("/"); revalidatePath(`/documents/${rev.documentId}`);
        return { ok: `Approved ${label}.` };
      }
    }
    try {
      await recordApproval(ctx, revisionId, user, note || undefined);
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Approval rejected." };
    }
    revalidatePath("/"); revalidatePath(`/documents/${rev.documentId}`);
    return { ok: `Approved ${label}. The control function can now release it.` };
  }

  if (decision === "request_changes") {
    if (!note) return { error: "Tell the author what needs to change — a comment is required." };
    let cycleIdToUse = cycleId;
    if (!cycleIdToUse) {
      const open = await db.reviewCycle.findFirst({ where: { revisionId, status: "OPEN" }, orderBy: { sequence: "desc" } });
      cycleIdToUse = open?.id ?? null;
    }
    if (cycleIdToUse) {
      const assigned = await db.reviewAssignment.findFirst({ where: { cycleId: cycleIdToUse, userId: user.id } });
      if (!assigned && !isController(user) && !isAdmin(user)) return { error: "This decision was not assigned to you." };
      const cycle = await db.reviewCycle.findUniqueOrThrow({ where: { id: cycleIdToUse } });
      if (cycle.issuedToReviewAt) {
        const { requestChangesOutcomeCode } = await import("@/lib/config-props");
        const outcomeCode = await requestChangesOutcomeCode();
        try {
          await recordReviewOutcome(ctx, cycleIdToUse, user, outcomeCode ?? "REVISE_AND_RESUBMIT", note);
        } catch (e) {
          return { error: e instanceof Error ? e.message : "Could not record the decision." };
        }
        await db.reviewComment.create({
          data: { projectId, cycleId: cycleIdToUse, authorId: user.id, authorName: user.name, text: note, classification: "BLOCKING", progressionPreventing: true, status: "OPEN" },
        });
        // route back through the control function so the author receives outcome + authorization (§9.8)
        const controllers = await db.user.findMany({ where: { role: { in: ["CONTROLLER", "ADMIN"] }, active: true } });
        const canReturn = user.role === "CONTROLLER" || user.role === "ADMIN";
        if (canReturn) {
          await returnToOriginator(ctx, cycleIdToUse, user);
        } else {
          await notifyMany(controllers.map((c) => c.id), "REVIEW_RETURNED", `Decision recorded: ${label}`, `${user.name} requested changes — return to originator through the control function (§9.8).`, `/reviews/${cycleIdToUse}`);
        }
      } else {
        await db.reviewComment.create({
          data: { projectId, cycleId: cycleIdToUse, authorId: user.id, authorName: user.name, text: `[requested changes] ${note}`, classification: "BLOCKING", progressionPreventing: true, status: "OPEN" },
        });
      }
      revalidatePath("/"); revalidatePath(`/reviews/${cycleIdToUse}`); revalidatePath(`/documents/${rev.documentId}`);
      return { ok: `Changes requested on ${label}. The author has been notified.` };
    }
    return { error: `${label} has no open review cycle to record the decision on.` };
  }
  return { error: "Choose Approve or Request changes." };
}


/** Send several of your in-preparation revisions at once — each still gets its
 *  own review cycle (approval decisions attach to a revision, §8.3), but you
 *  pick the reviewer/approver once. */
export async function bulkSendAction(_prev: { error?: string; ok?: string } | undefined, formData: FormData): Promise<{ error?: string; ok?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  if (user.role === "VIEWER") return { error: "Viewers cannot submit revisions." };
  const revisionIds = formData.getAll("revisionIds").map(String).filter(Boolean);
  const reviewerIds = formData.getAll("reviewerIds").map(String).filter(Boolean);
  const mode = String(formData.get("mode") ?? "PARALLEL") as "PARALLEL" | "SERIAL";
  const note = String(formData.get("note") ?? "") || undefined;
  if (!revisionIds.length) return { error: "Select at least one revision." };
  if (!reviewerIds.length) return { error: "Choose who reviews/approves them (§9.1)." };

  const sent: string[] = [];
  const failed: string[] = [];
  for (const rid of revisionIds) {
    try {
      const rev = await db.revision.findUniqueOrThrow({ where: { id: rid }, include: { document: true } });
      if (!mayContributeToDocument(user, rev.document)) {
        failed.push(`${rev.document.docNumber}: not assigned to your organization`);
        continue;
      }
      await openReviewCycle(ctx, rid, user, { mode, reviewerIds, note });
      sent.push(`${rev.document.docNumber} rev ${rev.value}`);
    } catch (e) {
      failed.push(e instanceof Error ? e.message : "failed");
    }
  }
  if (sent.length) {
    revalidatePath("/"); revalidatePath("/documents");
    return { ok: `Sent ${sent.length}: ${sent.join(", ")}.${failed.length ? ` ${failed.length} failed — ${failed[0]}` : ""}`, error: undefined };
  }
  return { error: `None sent. ${failed[0] ?? ""}` };
}

"use server";

import { carrierRefusal } from "@/lib/control-activities";
import { revisionGround } from "@/lib/revision-ground";
import { mayAnswerCycle } from "@/lib/delegation";
import { startWorkflowRun } from "@/lib/workflow";
import { redirect } from "next/navigation";
import { requireScope } from "@/lib/scope";
import { revalidatePath } from "next/cache";
import { isController, isAdmin, mayContributeToDocument } from "@/lib/auth";
import { audit, notifyMany } from "@/lib/audit";
import { saveUpload } from "@/lib/files";
import { parseSteps, recordStepOutcome } from "@/lib/workflow";
import { requestFromForm } from "@/lib/issue-requests";
import { executionSeriesStarted, openReviewCycle, recordReviewOutcome, returnToOriginator, returnAtGate, issueToReview, recordApproval, releaseRevision, voidRevision } from "@/lib/lifecycle";
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
  let reasonForRevision = String(formData.get("reasonForRevision") ?? "").trim();
  const changeDescription = String(formData.get("changeDescription") ?? "").trim();
  const plannedSubmissionDate = String(formData.get("plannedSubmissionDate") ?? "") || null;
  const phase = String(formData.get("phase") ?? "") || null;

  const doc = await db.document.findUniqueOrThrow({ where: { id: documentId } });
  if (!mayContributeToDocument(user, doc)) return { error: "You may prepare revisions only for documents assigned to your organization." };
  try {
    await enforce("CREATE_REVISION", { documentId }, ctx);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Cannot start a revision." };
  }
 if (!changeDescription) return { error: "Description of change is required — it says what changed; it does not restate the reason." };

  // One revision in motion at a time. A document has exactly one revision being
  // worked on or reviewed; the next one starts when that one is released, or
  // sent back. Two at once would mean two answers to the same question.
  const moving = await db.revision.findFirst({ where: { documentId, state: { in: ["IN_PREPARATION", "IN_REVIEW", "NOT_RELEASED"] } }, orderBy: { createdAt: "desc" } });
  if (moving) {
    return { error: moving.state === "IN_PREPARATION"
      ? `Rev ${moving.value} is already in preparation. One revision at a time.`
      : moving.state === "NOT_RELEASED"
        ? `Rev ${moving.value} is decided and waiting for Document Control. One revision at a time — publish it, or send it back, before starting the next.`
        : `Rev ${moving.value} is in review. One revision at a time — finish that one, or send it back, before starting the next.` };
  }

  const isPlaceholder = doc.isPlaceholder;

  // Why this revision may exist, read from the one before it. A verdict that
  // asked for changes — or Document Control sending it back — is the reason
  // itself; a revision nobody asked for needs one written by whoever starts it.
  const ground = isPlaceholder ? { kind: "FIRST" as const } : await revisionGround(ctx, documentId);
  let authorizationReason: string;
  if (ground.kind === "FIRST") {
    if (!reasonForRevision) reasonForRevision = "First issue";
    authorizationReason = isPlaceholder ? "Placeholder register entry — authorization for the first revision." : "First revision.";
  } else if (ground.kind === "ASKED") {
    reasonForRevision = ground.why;
    authorizationReason = ground.why;
  } else {
    if (!reasonForRevision) return { error: "Say why a new revision is needed — the last one was accepted as it stands, so nobody asked for this one." };
    const cannotAuthorize = await carrierRefusal(ctx, "AUTHORIZE_REVISION", {
      control: isController(user) || isAdmin(user),
      standing: true,
    });
    if (cannotAuthorize) return { error: cannotAuthorize };
    authorizationReason = reasonForRevision;
  }
  const authorizedById = user.id;
  const authorizedByName = user.name;
  const authorizedAt = new Date();

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
      authoredById: user.id,
      authoredByName: user.name,
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
  const cycleId = String(formData.get("cycleId") ?? "");
  // Whoever sent it for review may issue it to the reviewers where the project
  // carries this out itself; where Document Control does, they do.
  const opened = await db.reviewCycle.findUnique({ where: { id: cycleId }, select: { openedById: true } });
  const cannotIssue = await carrierRefusal(ctx, "REVIEW_ISSUE", {
    control: isController(user) || isAdmin(user),
    standing: opened?.openedById === user.id,
  });
  if (cannotIssue) return { error: cannotIssue };
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
  // A reviewer comments on their own step; somebody holding a delegation from a
  // reviewer comments in their place, and the comment says so.
  const stands = await mayAnswerCycle(ctx, { cycleId, userId: user.id, verb: "REVIEW" });
  if (!stands.ok && !isController(user) && !isAdmin(user)) {
    return { error: "You may comment only on a review assigned to you, or one delegated to you by somebody it is assigned to." };
  }
  const text = String(formData.get("text") ?? "").trim();
  // One question, asked once: does this comment stop the release? The published
  // classification is still what gets stored, so the register is unchanged.
  const blocking = formData.get("blocking") === "on";
  const classes = await getActiveSet("COMMENT_CLASSES");
  const classification = classes.find((c) => (c.props.progressionPreventing === true) === blocking)?.code
    ?? (blocking ? "BLOCKING" : "NON_BLOCKING");
  if (!text) return { error: "Comment text is required." };
  // On a step held by an organization that is not on this system, our people do
  // the work for them: the comment is theirs, and the record says who wrote it
  // down.
  const cycle = await db.reviewCycle.findUnique({ where: { id: cycleId }, select: { party: { select: { name: true, kind: true } } } });
  const forParty = cycle?.party && cycle.party.kind === "OFFLINE" ? cycle.party.name : null;
  await db.reviewComment.create({
    data: {
      projectId, cycleId, authorId: user.id,
      authorName: forParty ? `${forParty} (recorded by ${user.name})` : user.name,
      text, classification, progressionPreventing: blocking,
    },
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

/**
 * Take back a comment that has not been given yet.
 *
 * A comment becomes part of the record when the step is answered: on an advisory
 * step it *is* the advice. Until then it is a draft the person is still writing,
 * and their own mistake is theirs to remove. After the answer, nothing goes —
 * a comment is settled by closing it with a resolution.
 */
export async function removeCommentAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db } = ctx;
  const commentId = String(formData.get("commentId") ?? "");
  const comment = await db.reviewComment.findUniqueOrThrow({ where: { id: commentId } });
  if (comment.authorId !== user.id) return { error: "A comment is taken back by whoever wrote it." };
  const cycle = await db.reviewCycle.findUniqueOrThrow({ where: { id: comment.cycleId }, select: { outcome: true, status: true } });
  if (cycle.outcome || cycle.status !== "OPEN") {
    return { error: "This review has been answered. A comment in the record is settled by closing it with a resolution, not removed." };
  }
  await db.reviewComment.delete({ where: { id: commentId } });
  await audit({
    actor: user,
    action: "REVIEW_COMMENT_REMOVED",
    entityType: "ReviewCycle",
    entityId: comment.cycleId,
    detail: `Taken back before the review was answered: “${comment.text.slice(0, 120)}”.`,
  });
  revalidatePath(`/reviews/${comment.cycleId}`);
  return {};
}

/**
 * Change a comment that has not been given yet. Same rule as taking one back:
 * until the review is answered it is a draft, and afterwards it is a record.
 */
export async function editCommentAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db } = ctx;
  const commentId = String(formData.get("commentId") ?? "");
  const text = String(formData.get("text") ?? "").trim();
  if (!text) return { error: "A comment says something — write it, or take it back." };
  const blocking = formData.get("blocking") === "on";
  const comment = await db.reviewComment.findUniqueOrThrow({ where: { id: commentId } });
  if (comment.authorId !== user.id) return { error: "A comment is changed by whoever wrote it." };
  const cycle = await db.reviewCycle.findUniqueOrThrow({ where: { id: comment.cycleId }, select: { outcome: true, status: true } });
  if (cycle.outcome || cycle.status !== "OPEN") {
    return { error: "This review has been answered. A comment in the record is settled by closing it with a resolution, not rewritten." };
  }
  const classes = await getActiveSet("COMMENT_CLASSES");
  const classification = classes.find((one) => (one.props.progressionPreventing === true) === blocking)?.code
    ?? (blocking ? "BLOCKING" : "NON_BLOCKING");
  await db.reviewComment.update({ where: { id: commentId }, data: { text, classification, progressionPreventing: blocking } });
  await audit({
    actor: user,
    action: "REVIEW_COMMENT_CHANGED",
    entityType: "ReviewCycle",
    entityId: comment.cycleId,
    oldValue: comment.text.slice(0, 200),
    newValue: text.slice(0, 200),
    detail: "Changed before the review was answered.",
  });
  revalidatePath(`/reviews/${comment.cycleId}`);
  return {};
}

/** Close a progression-preventing comment — only with a recorded resolution (§9.6). */
export async function closeCommentAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  const commentId = String(formData.get("commentId") ?? "");
  const comment = await db.reviewComment.findUniqueOrThrow({ where: { id: commentId } });
  const assigned = (await mayAnswerCycle(ctx, { cycleId: comment.cycleId, userId: user.id, verb: "REVIEW" })).ok;
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
  const note = String(formData.get("comment") ?? "").trim() || String(formData.get("outcomeNote") ?? "").trim() || undefined;
  const issuedFor = String(formData.get("issuedFor") ?? "").trim() || undefined;
  const confirmedStatus = formData.get("confirmStatus") === "on";
  // A reservation held against a later step of the same route, rather than
  // against the next revision.
  const closesWithStep = Number(formData.get("closesWithStep") ?? "") || null;
  try {
    await enforce("RECORD_OUTCOME", { cycleId, outcomeCode: outcome }, ctx);
    // A cycle that belongs to a review route is decided through the route, so
    // the route advances, returns or completes — there is one way to decide.
    const cycle = await db.reviewCycle.findUniqueOrThrow({
      where: { id: cycleId },
      select: { revisionId: true, partyId: true, party: { select: { name: true, kind: true, evidenceRequired: true } }, files: { select: { id: true } }, revision: { select: { value: true, document: { select: { docNumber: true } } } } },
    });
    const forParty = cycle.party && cycle.party.kind === "OFFLINE" ? cycle.party : null;
    if (forParty) {
      // Their answer arrived outside this system, so the only thing standing
      // behind it is what they sent.
      const proof = formData.get("evidence");
      if (proof instanceof File && proof.size > 0) {
        const { saveUpload } = await import("@/lib/files");
        const saved = await saveUpload(ctx, proof, cycle.revision.document.docNumber, "EVIDENCE", cycle.revision.value);
        await db.storedFile.create({
          data: {
            projectId, name: saved.name, path: saved.relPath, size: saved.size, mime: saved.mime, sha256: saved.sha256,
            kind: "EVIDENCE", revisionId: cycle.revisionId, cycleId, uploadedById: user.id, uploadedByName: user.name,
          },
        });
      } else if (forParty.evidenceRequired && !cycle.files.length) {
        return { error: `Attach what ${forParty.name} sent — an answer recorded for them with no proof is only your word.` };
      }
      const theirCode = String(formData.get("theirCode") ?? "").trim() || null;
      const theirPerson = String(formData.get("theirPerson") ?? "").trim() || null;
      await db.reviewCycle.update({
        where: { id: cycleId },
        data: { recordedById: user.id, recordedByName: user.name, foreignOutcome: theirCode, outcomeByName: theirPerson ? `${theirPerson}, ${forParty.name}` : forParty.name },
      });
    }
    const runs = await db.workflowRun.findMany({ where: { revisionId: cycle.revisionId } });
    const run = runs.find((r) => parseSteps(r.steps).some((s) => s.cycleId === cycleId));
    if (run) {
      const current = parseSteps(run.steps)[run.currentStep];
      if (run.status !== "ACTIVE" || current?.cycleId !== cycleId) return { error: "This step of the review route is closed." };
      const res = await recordStepOutcome(ctx, run.id, user, outcome, note, issuedFor, confirmedStatus, closesWithStep, requestFromForm(formData), forParty?.name);
      if (!res.ok) return { error: res.error };
    } else {
      await recordReviewOutcome(ctx, cycleId, user, outcome, note, issuedFor);
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
  const cycleId = String(formData.get("cycleId") ?? "");
  // A reviewer of the step may return it where the project carries this out
  // itself; where Document Control does, an answer never goes straight back.
  const answered = await db.reviewCycle.findUnique({ where: { id: cycleId }, select: { assignments: { select: { userId: true } } } });
  const cannotReturn = await carrierRefusal(ctx, "RETURN_OUTCOME", {
    control: isController(user) || isAdmin(user),
    standing: !!answered?.assignments.some((seat) => seat.userId === user.id),
  });
  if (cannotReturn) return { error: cannotReturn };
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
    // Releasing is issuing: the act sends what was asked for, so nothing is
    // carried out separately here.
    result = await releaseRevision(ctx, revisionId, user, statusCode);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Release blocked." };
  }
  const rev = await db.revision.findUniqueOrThrow({ where: { id: revisionId } });
  revalidatePath(`/documents/${rev.documentId}`);
  redirect(`/documents/${rev.documentId}?released=1&superseded=${result.superseded ?? ""}`);
}

/** Document Control refuses to publish a decided revision and says why. */
export async function returnAtGateAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db } = ctx;
  if (!isController(user) && !isAdmin(user)) return { error: "Only the control function sends a revision back from the gate." };
  const revisionId = String(formData.get("revisionId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  try {
    // Who is copied in, as Document Control left the list; not sent, the route's people.
    const copies = formData.has("copiesChosen") ? formData.getAll("copyUsers").map(String).filter(Boolean) : undefined;
    await returnAtGate(ctx, revisionId, user, reason, Number(formData.get("toStep") ?? "") || null, String(formData.get("returnReason") ?? "").trim() || null, copies);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not send it back." };
  }
  const rev = await db.revision.findUniqueOrThrow({ where: { id: revisionId } });
  revalidatePath(`/documents/${rev.documentId}`);
  return {};
}

/**
 * §7.2 — void, by decision of the authority that approved it. Only ever the
 * newest revision: everything before it is frozen as it was issued, and a void
 * on a revision already replaced would change nothing anybody works from.
 */
export async function voidRevisionAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  const revisionId = String(formData.get("revisionId") ?? "");
  const reason = String(formData.get("voidReason") ?? "").trim();
  const reassessment = String(formData.get("reassessment") ?? "").trim() || undefined;
 if (!reason) return { error: "Voiding is recorded with a reason." };
  const subject = await db.revision.findUniqueOrThrow({ where: { id: revisionId } });
  const newer = await db.revision.findFirst({
    where: { documentId: subject.documentId, createdAt: { gt: subject.createdAt } },
    orderBy: { createdAt: "desc" },
    select: { value: true },
  });
  if (newer) return { error: `Rev ${subject.value} has already been replaced by rev ${newer.value}. Only the newest revision can be voided; everything before it is frozen as it was issued.` };
  // Where Document Control carries this out, anybody who thinks a revision
  // should be voided asks them, and the reason on the record says who asked.
  const wroteIt = subject.authoredById === user.id || subject.uploadedById === user.id;
  const cannotVoid = await carrierRefusal(ctx, "VOID", { control: isController(user) || isAdmin(user), standing: wroteIt });
  if (cannotVoid) return { error: cannotVoid };
  // Released in error, or never reviewed at all. A revision in the middle of a
  // route is neither: finish it, or send it back.
  const reviewed = await db.reviewCycle.count({ where: { revisionId } });
  const voidable = subject.state === "RELEASED" || (subject.state === "IN_PREPARATION" && reviewed === 0);
  if (!voidable) {
    return { error: `Rev ${subject.value} is ${subject.state.replaceAll("_", " ").toLowerCase()}. A revision is voided when it was released in error, or when it was never reviewed at all.` };
  }
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
  const revisionId = String(formData.get("revisionId") ?? "");
  const voided = await db.revision.findUnique({ where: { id: revisionId }, select: { authoredById: true, uploadedById: true } });
  const cannotRecord = await carrierRefusal(ctx, "VOID", {
    control: isController(user) || isAdmin(user),
    standing: voided?.authoredById === user.id || voided?.uploadedById === user.id,
  });
  if (cannotRecord) return { error: cannotRecord };
  const note = String(formData.get("note") ?? "").trim();
 if (!note) return { error: "Describe the reassessment of work performed." };
  await db.revision.update({ where: { id: revisionId }, data: { voidReassessment: note } });
 await audit({ actor: user, action: "STATE_TRANSITION", entityType: "Revision", entityId: revisionId, detail: "Void reassessment recorded." });
  revalidatePath("/exposures");
  return {};
}

/** An approval asked for after release came back yes: the hold is lifted and what waited is sent. */
export async function liftHoldAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db } = ctx;
  if (!isController(user) && !isAdmin(user)) return { error: "Document Control lifts a hold." };
  const revisionId = String(formData.get("revisionId") ?? "");
  try {
    const { liftHold } = await import("@/lib/issue-requests");
    await liftHold(ctx, revisionId, user);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "The hold could not be lifted." };
  }
  const rev = await db.revision.findUniqueOrThrow({ where: { id: revisionId } });
  revalidatePath(`/documents/${rev.documentId}`);
  return {};
}

/** An approval asked for after release came back no: it stays on hold for good, and goes back with a reason. */
export async function returnHeldAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db } = ctx;
  if (!isController(user) && !isAdmin(user)) return { error: "Only the control function sends a revision back." };
  const revisionId = String(formData.get("revisionId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  try {
    const { returnHeld } = await import("@/lib/issue-requests");
    await returnHeld(ctx, revisionId, user, reason, formData.getAll("copyUsers").map(String).filter(Boolean));
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not send it back." };
  }
  const rev = await db.revision.findUniqueOrThrow({ where: { id: revisionId } });
  revalidatePath(`/documents/${rev.documentId}`);
  return {};
}

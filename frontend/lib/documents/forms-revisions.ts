"use server";

import { redirect } from "next/navigation";
import { requireScope } from "@/lib/core/scope";
import { revalidatePath } from "next/cache";
import { getActiveSet } from "@/lib/settings/config";
import { api, projectPath, refusal } from "@/lib/client";
import { backendRevision, backendReview, reviewOfRevision } from "@/lib/documents/api";
import { upload, filesOf, uploadRevisionFiles } from "@/lib/documents/api-uploads";
import { requestFromForm, issueAsk } from "@/lib/transmittals/issue-requests";
import { once } from "@/lib/core/once";

/**
 * A revision's acts. The backend decides who may and whether the revision is
 * ready; these send what the form says and show its refusal word for word.
 *
 * A review cycle on these screens is the backend's review: its id is the
 * review's id.
 */

type Result = { error?: string };
const failed = (e: unknown): Result => ({ error: refusal(e).message });
const text = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

// Start the next revision. Its files can come with it, or be attached after.
export async function prepareRevisionAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const documentId = text(formData, "documentId");
  const changeDescription = text(formData, "changeDescription");
  if (!changeDescription) return { error: "Say what changes in this revision, and why." };
  try {
    const fileIds = await uploadRevisionFiles(ctx, documentId, formData);
    await api(projectPath(ctx, `/documents/${documentId}/revisions`), {
      body: { fileIds, reasonForRevision: text(formData, "reasonForRevision") || changeDescription, changeDescription, filesLater: fileIds.length === 0, purpose: text(formData, "purpose") || null, phase: text(formData, "phase") || null },
    });
    // Sent for review from the document's page, where the route and its people are chosen.
  } catch (e) {
    return failed(e);
  }
  revalidatePath(`/documents/${documentId}`);
  return {};
}

/**
 * Edit a revision not yet released, in one go: its files and the document's
 * details. While nothing has looked at its files (no review, no transmittal), a
 * new file replaces the one of its kind outright, the earlier one gone (a draft
 * has no value); past that, as a new submission, the earlier kept. A revision
 * without files yet simply takes them. Its author or the control function only, for the files.
 */
export async function editRevisionAction(_prev: Result | undefined, formData: FormData): Promise<Result & { ok?: string }> {
  const ctx = await requireScope();
  const revisionId = text(formData, "revisionId");
  const files = filesOf(formData, "nativeFile", "renditionFile");
  let documentId: string;
  // The same file sent again changes nothing (backend SAME_FILES): said, and the details are still saved.
  let same: string | null = null;
  try {
    documentId = (await backendRevision(ctx, revisionId)).documentId;
    if (files.length) {
      const fileIds = await uploadRevisionFiles(ctx, documentId, formData);
      const path = text(formData, "hasFiles") === "yes" ? "update" : "files";
      try {
        await api(projectPath(ctx, `/documents/${documentId}/revisions/${revisionId}/${path}`), { body: { fileIds } });
      } catch (e) {
        if (refusal(e).code !== "SAME_FILES") throw e;
        same = refusal(e).message;
      }
    }
  } catch (e) {
    return failed(e);
  }
  const { updateDocumentAction } = await import("@/lib/documents/forms");
  const details = await updateDocumentAction(undefined, formData);
  revalidatePath(`/documents/${documentId}`);
  if (details.error) return { error: files.length && !same ? `The files are in; the details were not saved: ${details.error}` : details.error };
  return { ok: same ? `${same} The details are saved.` : files.length ? "Saved: files and details." : details.ok ?? "Saved." };
}

/** Take a revision out of its review to edit it: closed as withdrawn, everyone on it told, comments kept. */
export async function withdrawRevisionAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const revisionId = text(formData, "revisionId");
  const reason = text(formData, "reason");
  if (!reason) return { error: "Say why it is taken out of review: everyone on the route is told." };
  let documentId: string;
  try {
    documentId = (await backendRevision(ctx, revisionId)).documentId;
    await api(projectPath(ctx, `/documents/${documentId}/revisions/${revisionId}/withdraw`), { body: { changeDescription: reason }, idempotencyKey: once(formData, "withdraw") });
  } catch (e) {
    return failed(e);
  }
  revalidatePath(`/documents/${documentId}`);
  revalidatePath("/reviews", "layout");
  return {};
}

/** The control function sends a review waiting for it to its reviewers (where the project has it do so). */
export async function issueToReviewAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const cycleId = text(formData, "cycleId");
  try {
    await api(projectPath(ctx, `/reviews/${cycleId}/issue`), { method: "POST", idempotencyKey: once(formData, "issue") });
  } catch (e) {
    return failed(e);
  }
  revalidatePath(`/reviews/${cycleId}`);
  revalidatePath("/");
  return {};
}

/** Taking a comment back before the step is answered: until then it is a draft. */
export async function removeCommentAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const commentId = text(formData, "commentId");
  const cycleId = text(formData, "cycleId");
  if (!cycleId) return { error: "Say which review the comment is on." };
  try {
    await api(projectPath(ctx, `/reviews/${cycleId}/comments/${commentId}`), { method: "DELETE" });
  } catch (e) {
    return failed(e);
  }
  revalidatePath(`/reviews/${cycleId}`);
  return {};
}

/**
 * Change a comment that has not been given yet. Same rule as taking one back:
 * until the step is answered it is a draft, and afterwards it is a record.
 */
export async function editCommentAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const commentId = text(formData, "commentId");
  const body = text(formData, "text");
  if (!body) return { error: "A comment says something — write it, or take it back." };
  const blocking = formData.get("blocking") === "on";
  const classes = await getActiveSet("COMMENT_CLASSES");
  const classification = classes.find((c) => (c.props.progressionPreventing === true || c.props.blocking === true) === blocking)?.code
    ?? (blocking ? "BLOCKING" : "NON_BLOCKING");
  const cycleId = text(formData, "cycleId");
  if (!cycleId) return { error: "Say which review the comment is on." };
  try {
    await api(projectPath(ctx, `/reviews/${cycleId}/comments/${commentId}`), { method: "PUT", body: { text: body, class: classification } });
  } catch (e) {
    return failed(e);
  }
  revalidatePath(`/reviews/${cycleId}`);
  return {};
}

/** Answer the open step: a verdict and status on the deciding step, advice before it. */
export async function recordOutcomeAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const cycleId = text(formData, "cycleId");
  const note = text(formData, "comment") || text(formData, "outcomeNote") || null;
  try {
    const review = await backendReview(ctx, cycleId);
    const open = review.steps.find((one) => one.state === "OPEN");
    if (!open) return { error: "This step of the review route is closed." };
    // Their answer arrived outside this system: the proof of it is filed first.
    const proof = filesOf(formData, "evidence")[0];
    const evidenceFileId = proof ? await upload(ctx, { reviewId: cycleId }, proof) : null;
    const asked = requestFromForm(formData);
    if (open.deciding && asked.needsApproval && !asked.approverId) return { error: "Say which party has to approve it before it is released." };
    const issue = open.deciding ? issueAsk(asked) : null;
    await api(projectPath(ctx, `/reviews/${cycleId}/answer`), {
      body: {
        verdict: text(formData, "outcome") || null,
        status: text(formData, "issuedFor") || null,
        note, issue, foreignAnswer: text(formData, "theirCode") || null, evidenceFileId,
        closesWithStep: Number(text(formData, "closesWithStep")) || null,
      },
      idempotencyKey: once(formData, "answer"),
    });
  } catch (e) {
    return failed(e);
  }
  revalidatePath(`/reviews/${cycleId}`);
  revalidatePath("/");
  return {};
}

/** the control function sends the decided revision back to its author. */
export async function returnToOriginatorAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const cycleId = text(formData, "cycleId");
  try {
    await api(projectPath(ctx, `/reviews/${cycleId}/return`), { body: { note: text(formData, "reason") || text(formData, "note") || "Returned to its author." }, idempotencyKey: once(formData, "return") });
  } catch (e) {
    return failed(e);
  }
  revalidatePath(`/reviews/${cycleId}`);
  return {};
}

// G.1 steps 11–13 — release at a status (§7.6), superseding the current revision (§7.5)
export async function releaseRevisionAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const revisionId = text(formData, "revisionId");
  const statusCode = text(formData, "statusCode");
  if (!statusCode) return { error: "Choose the status the revision is released at." };
  // Released and issued in one act: who receives it, when the decision did not say. The backend refuses a release
  // with nobody to send to unless the organization keeps the two apart.
  const named = issueAsk(requestFromForm(formData));
  const issue = named && !named.delegated ? named : null;
  // Of what was asked, who the control function keeps; anyone left out is taken off, and the request says so.
  const kept = formData.getAll("keptRequest").map(String).map((requestId) => {
    const keep = formData.getAll(`keep_${requestId}`).map(String);
    return {
      requestId,
      userIds: keep.filter((one) => one.startsWith("u:")).map((one) => one.slice(2)),
      partyIds: keep.filter((one) => one.startsWith("p:")).map((one) => one.slice(2)),
    };
  });
  let documentId: string;
  try {
    let review = await reviewOfRevision(ctx, revisionId);
    if (!review) {
      // Never reviewed: only a type released without a review goes straight to release, at the status chosen.
      try {
        review = await api<{ id: string; documentId: string; state: string }>(projectPath(ctx, `/revisions/${revisionId}/send-on`), { body: { status: statusCode }, idempotencyKey: once(formData, "send-on") });
      } catch (e) {
        if (refusal(e).code === "TYPE_IS_REVIEWED") return { error: "This type of document is reviewed: send it for review first." };
        throw e;
      }
      documentId = review.documentId;
      // Where nobody acts as the control function it is already released.
      if (review.state !== "RELEASED") await api(projectPath(ctx, `/reviews/${review.id}/release`), { body: { status: statusCode, outcome: text(formData, "outcome") || null, issue, kept }, idempotencyKey: once(formData, "release") });
    } else {
      documentId = review.documentId;
      await api(projectPath(ctx, `/reviews/${review.id}/release`), { body: { status: statusCode, outcome: text(formData, "outcome") || null, issue, kept }, idempotencyKey: once(formData, "release") });
    }
  } catch (e) {
    return failed(e);
  }
  revalidatePath(`/documents/${documentId}`);
  redirect(`/documents/${documentId}?released=1&superseded=`);
}

/** the control function refuses to publish a decided revision and says why: back to its author, or the route back to a step. */
export async function returnAtGateAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const revisionId = text(formData, "revisionId");
  const reason = text(formData, "reason");
  let documentId: string;
  try {
    const review = await reviewOfRevision(ctx, revisionId);
    if (!review) return { error: "This revision has not been reviewed." };
    documentId = review.documentId;
    await api(projectPath(ctx, `/reviews/${review.id}/return`), {
      body: {
        note: reason || null, toStep: Number(formData.get("toStep") ?? "") || null,
        reason: text(formData, "returnReason") || null, outcome: text(formData, "outcome") || null,
      },
      idempotencyKey: once(formData, "return"),
    });
  } catch (e) {
    return failed(e);
  }
  revalidatePath(`/documents/${documentId}`);
  return {};
}

/** §7.2 — void: the newest revision, released in error or never reviewed. */
export async function voidRevisionAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const revisionId = text(formData, "revisionId");
  const reason = text(formData, "voidReason");
  if (!reason) return { error: "Voiding is recorded with a reason." };
  let documentId: string;
  try {
    documentId = (await backendRevision(ctx, revisionId)).documentId;
    await api(projectPath(ctx, `/documents/${documentId}/revisions/${revisionId}/void`), {
      body: { reason, reassessment: text(formData, "reassessment") || null },
    });
  } catch (e) {
    return failed(e);
  }
  revalidatePath(`/documents/${documentId}`);
  return {};
}

/** Take a void back, with a reason: the revision counts again. The control function's. */
export async function unvoidRevisionAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const revisionId = text(formData, "revisionId");
  const reason = text(formData, "reason");
  if (!reason) return { error: "Say why the void is taken back." };
  let documentId: string;
  try {
    documentId = (await backendRevision(ctx, revisionId)).documentId;
    await api(projectPath(ctx, `/documents/${documentId}/revisions/${revisionId}/unvoid`), { body: { reason } });
  } catch (e) {
    return failed(e);
  }
  revalidatePath(`/documents/${documentId}`);
  return {};
}

/** §12.6 — the reassessment of work performed under a voided revision. */
export async function recordVoidReassessmentAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const revisionId = text(formData, "revisionId");
  const note = text(formData, "note");
  if (!note) return { error: "Describe the reassessment of work performed." };
  try {
    await api(projectPath(ctx, `/revisions/${revisionId}/reassessment`), { body: { note } });
  } catch (e) {
    return failed(e);
  }
  revalidatePath("/exposures");
  return {};
}

/** An approval asked for after release came back yes: the hold is lifted and what waited is sent. */
export async function liftHoldAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const revisionId = text(formData, "revisionId");
  let documentId: string;
  try {
    documentId = (await backendRevision(ctx, revisionId)).documentId;
    await api(projectPath(ctx, `/revisions/${revisionId}/hold/lift`), { method: "POST" });
  } catch (e) {
    return failed(e);
  }
  revalidatePath(`/documents/${documentId}`);
  return {};
}

/** An approval asked for after release came back no: it stays on hold for good, and goes back with a reason. */
export async function returnHeldAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const revisionId = text(formData, "revisionId");
  const reason = text(formData, "reason");
  if (!reason) return { error: "Say why it is going back — whoever gets it has to know what to do." };
  let documentId: string;
  try {
    documentId = (await backendRevision(ctx, revisionId)).documentId;
    await api(projectPath(ctx, `/revisions/${revisionId}/hold/return`), { body: { reason } });
  } catch (e) {
    return failed(e);
  }
  revalidatePath(`/documents/${documentId}`);
  return {};
}

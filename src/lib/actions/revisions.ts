"use server";

import { redirect } from "next/navigation";
import { requireScope } from "@/lib/scope";
import { revalidatePath } from "next/cache";
import { getActiveSet } from "@/lib/config";
import { api, projectPath, refusal } from "@/lib/api/client";
import { backendRevision, backendReview, reviewOfRevision } from "@/lib/api/legacy";
import { upload, filesOf } from "@/lib/api/uploads";
import { requestFromForm } from "@/lib/issue-requests";

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
  if (!changeDescription) return { error: "Description of change is required — it says what changed; it does not restate the reason." };
  try {
    const files = filesOf(formData, "revisionFile");
    const fileIds = await Promise.all(files.map((file) => upload(ctx, { documentId }, file)));
    const revision = await api<{ id: string; value: string }>(projectPath(ctx, `/documents/${documentId}/revisions`), {
      body: { fileIds, reasonForRevision: text(formData, "reasonForRevision") || null, changeDescription, filesLater: fileIds.length === 0 },
    });
    // The send can come with the new revision, so a resubmission is one form rather than three.
    const routeId = text(formData, "sendTemplateId");
    if (routeId && fileIds.length) {
      try {
        await api(projectPath(ctx, `/revisions/${revision.id}/reviews`), { body: { routeId } });
      } catch (e) {
        revalidatePath(`/documents/${documentId}`);
        return { error: `Rev ${revision.value} was created but not sent: ${refusal(e).message}` };
      }
    }
  } catch (e) {
    return failed(e);
  }
  revalidatePath(`/documents/${documentId}`);
  return {};
}

export async function uploadRevisionFilesAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const revisionId = text(formData, "revisionId");
  const files = filesOf(formData, "nativeFile", "renditionFile");
  if (!files.length) return { error: "Choose at least one file." };
  let documentId: string;
  try {
    documentId = (await backendRevision(ctx, revisionId)).documentId;
    const fileIds = await Promise.all(files.map((file) => upload(ctx, { documentId }, file)));
    await api(projectPath(ctx, `/documents/${documentId}/revisions/${revisionId}/files`), { body: { fileIds } });
  } catch (e) {
    return failed(e);
  }
  revalidatePath(`/documents/${documentId}`);
  return {};
}

/** The review goes to its reviewers as soon as it starts; there is no separate issuing. */
export async function issueToReviewAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const cycleId = text(formData, "cycleId");
  revalidatePath(`/reviews/${cycleId}`);
  return {};
}

export async function addCommentAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const cycleId = text(formData, "cycleId");
  const body = text(formData, "text");
  if (!body) return { error: "Comment text is required." };
  // One question, asked once: does this comment stop the release? The published
  // classification is still what gets stored.
  const blocking = formData.get("blocking") === "on";
  const classes = await getActiveSet("COMMENT_CLASSES");
  const classification = classes.find((c) => (c.props.progressionPreventing === true) === blocking)?.code
    ?? (blocking ? "BLOCKING" : "NON_BLOCKING");
  try {
    await api(projectPath(ctx, `/reviews/${cycleId}/comments`), {
      body: { text: body, class: classification, closesWithStep: Number(formData.get("closesWithStep") ?? "") || null },
    });
  } catch (e) {
    return failed(e);
  }
  revalidatePath(`/reviews/${cycleId}`);
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

/** Close a progression-preventing comment — only with a recorded resolution (§9.6). */
export async function closeCommentAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const commentId = text(formData, "commentId");
  const cycleId = text(formData, "cycleId");
  const resolution = text(formData, "resolution");
  if (!resolution) return { error: "A progression-preventing comment is closed only with a recorded resolution." };
  try {
    await api(projectPath(ctx, `/reviews/${cycleId}/comments/${commentId}/close`), { body: { resolution } });
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
    const issue = open.deciding && (asked.recipients.internalUserIds.length || asked.recipients.partyIds.length)
      ? { reason: asked.reason, userIds: asked.recipients.internalUserIds, partyIds: asked.recipients.partyIds, note: asked.note }
      : null;
    await api(projectPath(ctx, `/reviews/${cycleId}/answer`), {
      body: {
        verdict: open.deciding ? text(formData, "outcome") || null : null,
        status: open.deciding ? text(formData, "issuedFor") || null : null,
        note, issue, foreignAnswer: text(formData, "theirCode") || null, evidenceFileId,
      },
    });
  } catch (e) {
    return failed(e);
  }
  revalidatePath(`/reviews/${cycleId}`);
  revalidatePath("/");
  return {};
}

/** Document Control sends the decided revision back to its author. */
export async function returnToOriginatorAction(_prev: Result | undefined, formData: FormData): Promise<Result> {
  const ctx = await requireScope();
  const cycleId = text(formData, "cycleId");
  try {
    await api(projectPath(ctx, `/reviews/${cycleId}/return`), { body: { note: text(formData, "reason") || text(formData, "note") || "Returned to its author." } });
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
  let documentId: string;
  try {
    const review = await reviewOfRevision(ctx, revisionId);
    if (!review) return { error: "Releasing a revision that was never reviewed is not supported yet." };
    documentId = review.documentId;
    await api(projectPath(ctx, `/reviews/${review.id}/release`), { body: { status: statusCode, outcome: text(formData, "outcome") || null } });
  } catch (e) {
    return failed(e);
  }
  revalidatePath(`/documents/${documentId}`);
  redirect(`/documents/${documentId}?released=1&superseded=`);
}

/** Document Control refuses to publish a decided revision and says why: back to its author, or the route back to a step. */
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
    });
  } catch (e) {
    return failed(e);
  }
  revalidatePath(`/documents/${documentId}`);
  return {};
}

/** §7.2 — void: not in the backend yet. */
export async function voidRevisionAction(_prev: Result | undefined, _formData: FormData): Promise<Result> {
  return { error: "Voiding a revision is not supported yet." };
}

/** §12.6 — the reassessment of work performed under a voided revision: not in the backend yet. */
export async function recordVoidReassessmentAction(_prev: Result | undefined, _formData: FormData): Promise<Result> {
  return { error: "Recording a void reassessment is not supported yet." };
}

/** Holding a released revision for an outside approval is not in the backend. */
export async function liftHoldAction(_prev: Result | undefined, _formData: FormData): Promise<Result> {
  return { error: "Holds are not supported yet." };
}

/** Holding a released revision for an outside approval is not in the backend. */
export async function returnHeldAction(_prev: Result | undefined, _formData: FormData): Promise<Result> {
  return { error: "Holds are not supported yet." };
}

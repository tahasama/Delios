"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/scope";
import { isController, isAdmin } from "@/lib/auth";
import { audit, notify } from "@/lib/audit";
import {
  carryOutRequest,
  issueGateIsControl,
  mayRequestIssue,
  noRecipients,
  requestFromForm,
} from "@/lib/issue-requests";

/**
 * Asking for a revision to be sent somewhere, and carrying that out.
 *
 * Anybody with standing on the document may ask — whoever wrote it, uploaded
 * it, started its review or decided it. Document Control carries the request
 * out when it publishes, or later; where a project runs without a control
 * function, whoever asked carries it out themselves.
 */

/** Raise a request against a revision, at any time. */
export async function requestIssueAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId } = ctx;
  const revisionId = String(formData.get("revisionId") ?? "");
  const rev = await db.revision.findUnique({ where: { id: revisionId }, include: { document: true } });
  if (!rev) return { error: "That revision no longer exists." };
  const standing = await mayRequestIssue(ctx, revisionId, user.id);
  if (!standing && !isController(user) && !isAdmin(user)) {
    return { error: "Only somebody who worked on this revision — its author, whoever uploaded it, whoever reviewed or decided it — asks for it to be sent." };
  }
  const asked = requestFromForm(formData);
  if (!asked.delegated && noRecipients(asked.recipients)) {
    return { error: "Say who it goes to, or leave it to the author." };
  }
  const request = await db.issueRequest.create({
    data: {
      projectId,
      revisionId,
      reason: asked.reason,
      recipients: JSON.stringify(asked.recipients),
      note: asked.note,
      delegated: asked.delegated,
      raisedById: user.id,
      raisedByName: user.name,
    },
  });
  await audit({
    tenant: ctx, actor: user, action: "ISSUE_REQUESTED", entityType: "Revision", entityId: revisionId,
    entityLabel: `${rev.document.docNumber} rev ${rev.value}`, newValue: asked.reason,
    detail: asked.delegated ? "Left to the author to say who it goes to." : "Asked for it to be sent.",
  });
  if (asked.delegated) {
    await notify(
      rev.document.createdById,
      "ISSUE_DELEGATED",
      `Who should get ${rev.document.docNumber} rev ${rev.value}?`,
      `${user.name} left it to you to say who this revision goes to.`,
      `/documents/${rev.documentId}`,
      ctx,
    );
  }
  // Where nobody stands between the ask and the send, the asker sends it.
  if (rev.state === "RELEASED" && !(await issueGateIsControl(ctx)) && !asked.delegated) {
    await carryOutRequest(ctx, request.id, user);
  }
  revalidatePath(`/documents/${rev.documentId}`);
  return {};
}

/** Carry one request out: raise its transmittals. */
export async function carryOutRequestAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db } = ctx;
  const requestId = String(formData.get("requestId") ?? "");
  const request = await db.issueRequest.findUnique({ where: { id: requestId }, select: { revisionId: true, revision: { select: { documentId: true } } } });
  if (!request) return { error: "That request no longer exists." };
  // Document Control sends what was asked for. Where a project has no control
  // function, whoever has standing on the document sends it themselves.
  const control = isController(user) || isAdmin(user);
  const allowed = control || (!(await issueGateIsControl(ctx)) && (await mayRequestIssue(ctx, request.revisionId, user.id)));
  if (!allowed) return { error: "Document Control sends what was asked for." };
  const { error } = await carryOutRequest(ctx, requestId, user);
  if (error) return { error };
  revalidatePath(`/documents/${request.revision.documentId}`);
  return {};
}

/** Withdraw a request that is no longer wanted. */
export async function cancelRequestAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db } = ctx;
  const requestId = String(formData.get("requestId") ?? "");
  const request = await db.issueRequest.findUnique({ where: { id: requestId }, include: { revision: { select: { documentId: true } } } });
  if (!request) return { error: "That request no longer exists." };
  if (request.status !== "OPEN") return { error: "That request has already been dealt with." };
  if (request.raisedById !== user.id && !isController(user) && !isAdmin(user)) {
    return { error: "A request is withdrawn by whoever asked, or by Document Control." };
  }
  await db.issueRequest.update({ where: { id: requestId }, data: { status: "CANCELLED" } });
  await audit({
    tenant: ctx, actor: user, action: "ISSUE_REQUEST_CANCELLED", entityType: "Revision", entityId: request.revisionId,
    detail: `Request raised by ${request.raisedByName} withdrawn.`,
  });
  revalidatePath(`/documents/${request.revision.documentId}`);
  return {};
}

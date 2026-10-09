"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/scope";
import { refusal } from "@/lib/api/client";
import { backendRevision } from "@/lib/api/legacy";
import { cancelRequest, carryOutRequest, noRecipients, raiseRequest, requestFromForm } from "@/lib/issue-requests";

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
  const revisionId = String(formData.get("revisionId") ?? "");
  const asked = requestFromForm(formData);
  if (!asked.delegated && !asked.needsApproval && noRecipients(asked.recipients)) {
    return { error: "Say who it goes to, or leave it to the author." };
  }
  if (asked.needsApproval && !asked.approverId) return { error: "Say which party has to approve it." };
  // The backend checks standing, records the request, and sends it at once
  // where the revision is released and the asker is the one who sends.
  try {
    const rev = await backendRevision(ctx, revisionId);
    await raiseRequest(ctx, revisionId, asked);
    revalidatePath(`/documents/${rev.documentId}`);
    return {};
  } catch (e) {
    return { error: refusal(e).message };
  }
}

/** Carry one request out: raise its transmittals. */
export async function carryOutRequestAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const requestId = String(formData.get("requestId") ?? "");
  // Document Control sends what was asked for; where a project has no control
  // function, whoever has standing sends it. The backend decides.
  try {
    const { request } = await carryOutRequest(ctx, requestId);
    const rev = await backendRevision(ctx, request.revisionId);
    revalidatePath(`/documents/${rev.documentId}`);
    return {};
  } catch (e) {
    return { error: refusal(e).message };
  }
}

/** Withdraw a request that is no longer wanted. */
export async function cancelRequestAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const requestId = String(formData.get("requestId") ?? "");
  try {
    const request = await cancelRequest(ctx, requestId);
    const rev = await backendRevision(ctx, request.revisionId);
    revalidatePath(`/documents/${rev.documentId}`);
    return {};
  } catch (e) {
    return { error: refusal(e).message };
  }
}

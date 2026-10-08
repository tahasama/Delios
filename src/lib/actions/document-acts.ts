"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, refusal } from "@/lib/api/client";
import { requireSession, projectPath } from "@/lib/session";

/**
 * A document's acts, through the backend: getting upload links, starting a
 * revision or sending corrected files, Document Control's check on arrival,
 * and sending a revision for review. The backend decides who may; these
 * return its refusal as a message to show.
 */

export type ActResult = { ok: true; message?: string } | { ok: false; message: string };

export type UploadTicket = { fileId: string; method: string; url: string; headers: Record<string, string>; expiresAt: string };

/** Where an upload goes: a document's next files, or the proof of another organization's answer on a review. */
export type UploadTarget = { documentId: string } | { reviewId: string } | { transmittalId: string };

/** An upload link for one file, after the backend has checked its name, size and fingerprint. */
export async function requestUploadAction(target: UploadTarget, file: { fileName: string; size: number; contentType: string; sha256: string }):
  Promise<{ ok: true; ticket: UploadTicket } | { ok: false; message: string }> {
  const session = await requireSession();
  const path = "documentId" in target ? `/documents/${target.documentId}/uploads`
    : "reviewId" in target ? `/reviews/${target.reviewId}/evidence` : `/transmittals/${target.transmittalId}/evidence`;
  try {
    return { ok: true, ticket: await api<UploadTicket>(projectPath(session, path), { body: file }) };
  } catch (e) {
    return { ok: false, message: refusal(e).message };
  }
}

/** Starts a new revision with the files already uploaded. */
export async function startRevisionAction(documentId: string, fileIds: string[], reason: string, change: string): Promise<ActResult> {
  const session = await requireSession();
  try {
    await api(projectPath(session, `/documents/${documentId}/revisions`), {
      body: { fileIds, reasonForRevision: reason || null, changeDescription: change || null },
      idempotencyKey: `start-${documentId}-${fileIds.join("-")}`,
    });
  } catch (e) {
    return { ok: false, message: refusal(e).message };
  }
  revalidatePath(`/documents/${documentId}`);
  return { ok: true, message: "Revision started. The files are being scanned." };
}

/** Sends corrected files under the same revision, after Document Control returned it. */
export async function resubmitAction(documentId: string, revisionId: string, fileIds: string[]): Promise<ActResult> {
  const session = await requireSession();
  try {
    await api(projectPath(session, `/documents/${documentId}/revisions/${revisionId}/submissions`), { body: { fileIds } });
  } catch (e) {
    return { ok: false, message: refusal(e).message };
  }
  revalidatePath(`/documents/${documentId}`);
  return { ok: true, message: "Corrected files sent. They are being scanned." };
}

/** Document Control's check on what another organization sent: accept it, or return it with a reason. */
export async function arrivalAction(_prev: ActResult | undefined, form: FormData): Promise<ActResult> {
  const session = await requireSession();
  const documentId = String(form.get("documentId"));
  try {
    await api(projectPath(session, `/revisions/${form.get("revisionId")}/arrival`), {
      body: { outcome: String(form.get("outcome") ?? "") || null, note: String(form.get("note") ?? "").trim() || null },
    });
  } catch (e) {
    return { ok: false, message: refusal(e).message };
  }
  revalidatePath(`/documents/${documentId}`);
  return { ok: true, message: "Recorded." };
}

/** Sends a revision for review on the route chosen (or the one the organization's rules pick). */
export async function startReviewAction(_prev: ActResult | undefined, form: FormData): Promise<ActResult> {
  const session = await requireSession();
  const documentId = String(form.get("documentId"));
  const routeId = String(form.get("routeId") ?? "");
  try {
    await api(projectPath(session, `/revisions/${form.get("revisionId")}/reviews`), {
      body: { routeId: routeId || null },
      idempotencyKey: `review-${form.get("revisionId")}`,
    });
  } catch (e) {
    return { ok: false, message: refusal(e).message };
  }
  revalidatePath(`/documents/${documentId}`);
  return { ok: true, message: "Sent for review." };
}

export type RegisterState = { error?: string; field?: string };

/** Registers a new document; on success, opens it. The number is allocated by the backend. */
export async function registerDocumentAction(_prev: RegisterState | undefined, form: FormData): Promise<RegisterState> {
  const session = await requireSession();
  const text = (name: string) => String(form.get(name) ?? "").trim() || null;
  let id: string;
  try {
    const created = await api<{ id: string }>(projectPath(session, "/documents"), {
      body: {
        title: text("title"), deliverableType: text("deliverableType"), docType: text("docType"), discipline: text("discipline"),
        originator: text("originator"), subproject: text("subproject"), contractRef: text("contractRef"),
        criticality: text("criticality"), confidentiality: text("confidentiality"), retentionClass: text("retentionClass"),
        receivedDate: text("receivedDate"), plannedDate: text("plannedDate"),
      },
      idempotencyKey: text("formKey") ?? undefined,
    });
    id = created.id;
  } catch (e) {
    const problem = refusal(e);
    const field = (problem.params as { field?: string } | null)?.field;
    return { error: problem.message, field };
  }
  redirect(`/documents/${id}`);
}

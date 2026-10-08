"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, refusal } from "@/lib/api/client";
import { requireSession, projectPath } from "@/lib/session";
import type { ActResult } from "./document-acts";

/**
 * Issuing, through the backend: composing a transmittal, acknowledging one,
 * recording that one went to an organization outside the system, and asking
 * for a revision to be issued (and Document Control carrying that out).
 */

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim() || null;
const all = (form: FormData, name: string) => form.getAll(name).map(String).filter(Boolean);

export type ComposeState = { error?: string };

/** Composes and issues a transmittal; opens the first one made. */
export async function composeAction(_prev: ComposeState | undefined, form: FormData): Promise<ComposeState> {
  const session = await requireSession();
  let first: string;
  try {
    const sent = await api<{ id: string; number: string }[]>(projectPath(session, "/transmittals"), {
      body: {
        revisionIds: all(form, "revisionId"), userIds: all(form, "userId"), partyIds: all(form, "partyId"),
        reason: text(form, "reason"), subject: text(form, "subject"), message: text(form, "message"), responseDue: text(form, "responseDue"),
      },
      idempotencyKey: text(form, "formKey") ?? undefined,
    });
    first = sent[0].id;
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/transmittals");
  redirect(`/transmittals/${first}`);
}

export async function acknowledgeAction(_prev: ActResult | undefined, form: FormData): Promise<ActResult> {
  const session = await requireSession();
  const id = String(form.get("transmittalId"));
  try {
    await api(projectPath(session, `/transmittals/${id}/acknowledge`), { body: {} });
  } catch (e) {
    return { ok: false, message: refusal(e).message };
  }
  revalidatePath(`/transmittals/${id}`);
  return { ok: true, message: "Acknowledged." };
}

export async function dispatchRecipientAction(_prev: ActResult | undefined, form: FormData): Promise<ActResult> {
  const session = await requireSession();
  const id = String(form.get("transmittalId"));
  try {
    await api(projectPath(session, `/transmittals/${id}/recipients/${form.get("recipientId")}/dispatch`), {
      body: { channel: text(form, "channel"), reference: text(form, "reference"), proofFileId: text(form, "proofFileId") },
    });
  } catch (e) {
    return { ok: false, message: refusal(e).message };
  }
  revalidatePath(`/transmittals/${id}`);
  return { ok: true, message: "Recorded as sent." };
}

export async function requestIssueAction(_prev: ActResult | undefined, form: FormData): Promise<ActResult> {
  const session = await requireSession();
  const documentId = String(form.get("documentId"));
  try {
    await api(projectPath(session, `/revisions/${form.get("revisionId")}/issue-requests`), {
      body: { reason: text(form, "reason"), userIds: all(form, "userId"), partyIds: all(form, "partyId"), note: text(form, "note"), offDistributionReason: text(form, "offDistributionReason") },
      idempotencyKey: text(form, "formKey") ?? undefined,
    });
  } catch (e) {
    return { ok: false, message: refusal(e).message };
  }
  revalidatePath(`/documents/${documentId}`);
  return { ok: true, message: "Asked. Document Control will send it." };
}

export async function issueRequestAction(_prev: ActResult | undefined, form: FormData): Promise<ActResult> {
  const session = await requireSession();
  const documentId = String(form.get("documentId"));
  const what = String(form.get("what")) === "cancel" ? "cancel" : "carry-out";
  try {
    await api(projectPath(session, `/issue-requests/${form.get("requestId")}/${what}`), { body: {} });
  } catch (e) {
    return { ok: false, message: refusal(e).message };
  }
  revalidatePath(`/documents/${documentId}`);
  return { ok: true, message: what === "cancel" ? "Withdrawn." : "Sent." };
}

/** What another organization sends us, as the send form builds it. */
export type IncomingPayload = {
  reason: string; subject?: string; message?: string; theirReference?: string; fromPartyId?: string; proofFileId?: string;
  planned: { documentId: string; fileIds: string[]; status: string }[];
  unplanned: { title: string; docType?: string; reference?: string; fileIds: string[] }[];
  formKey: string;
};

/**
 * Sends to us on an incoming transmittal: filled placeholders at the status
 * proposed, corrections, and unplanned items. It is received, with its
 * receipt, the moment it is sent; opens it.
 */
export async function sendIncomingAction(payload: IncomingPayload): Promise<{ error: string }> {
  const session = await requireSession();
  let id: string;
  try {
    const sent = await api<{ id: string }>(projectPath(session, "/transmittals/incoming"), {
      body: {
        reason: payload.reason, subject: payload.subject || null, message: payload.message || null,
        theirReference: payload.theirReference || null, fromPartyId: payload.fromPartyId || null, proofFileId: payload.proofFileId || null,
        planned: payload.planned, unplanned: payload.unplanned.map((u) => ({ ...u, docType: u.docType || null, reference: u.reference || null })),
      },
      idempotencyKey: payload.formKey,
    });
    id = sent.id;
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath("/transmittals");
  revalidatePath("/");
  redirect(`/transmittals/${id}`);
}

/** Document Control puts an unplanned item in the register, under our numbering. */
export async function registerItemAction(_prev: ActResult | undefined, form: FormData): Promise<ActResult> {
  const session = await requireSession();
  const id = String(form.get("transmittalId"));
  try {
    await api(projectPath(session, `/transmittals/${id}/items/${form.get("itemId")}/register`), {
      body: {
        title: text(form, "title"), deliverableType: text(form, "deliverableType"), docType: text(form, "docType"),
        discipline: text(form, "discipline"), subproject: text(form, "subproject"), contractRef: text(form, "contractRef"),
        criticality: text(form, "criticality"), confidentiality: text(form, "confidentiality"),
      },
    });
  } catch (e) {
    return { ok: false, message: refusal(e).message };
  }
  revalidatePath(`/transmittals/${id}`);
  return { ok: true, message: "Registered." };
}

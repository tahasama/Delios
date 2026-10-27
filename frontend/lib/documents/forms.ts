"use server";

import { redirect } from "next/navigation";
import { requireScope } from "@/lib/core/scope";
import { isEmptyTitle } from "@/lib/core/standard";
import { revalidatePath } from "next/cache";
import { mayCreateDocument } from "@/lib/core/auth";
import { getActiveSet } from "@/lib/settings/config";
import { ownFields, takeExtras } from "@/lib/settings/field-policy";
import { api, ApiProblem, refusalForForm, projectPath, refusal } from "@/lib/client";
import { backendDocument } from "@/lib/documents/api";
import { filesOf, uploadRevisionFiles } from "@/lib/documents/api-uploads";
import type { TransmittalView } from "@/lib/types";
import { once } from "@/lib/core/once";

// G.1 — Creating a new document. "No controlled information shall be produced
// without a register entry" (§3.9). Number is system-generated (§3.7).

export async function createDocumentAction(_prev: { error?: string; fields?: string[] } | undefined, formData: FormData): Promise<{ error?: string; fields?: string[] }> {
  const ctx = await requireScope();
  const { user } = ctx;
  if (!mayCreateDocument(user)) return { error: user.isInternal ? "Read-only users cannot create documents." : "External parties cannot create register entries. The control function must issue a placeholder to your organization first." };

  const title = String(formData.get("title") ?? "").trim();
  const deliverableType = String(formData.get("deliverableType") ?? "");
  const docType = String(formData.get("docType") ?? "");
  const discipline = String(formData.get("discipline") ?? "");
  const originator = String(formData.get("originator") ?? "") || null;
  const subProject = String(formData.get("subProject") ?? "") || null;
  const phase = String(formData.get("phase") ?? "") || null;
  const contractRef = String(formData.get("contractRef") ?? "") || null;
  const criticality = String(formData.get("criticality") ?? "") || null;
  const confidentiality = String(formData.get("confidentiality") ?? "") || null;
  // Optional: when left empty it follows the criticality (§13.2, §5.6).
  const chosenRetention = String(formData.get("retentionClass") ?? "") || null;
  const receivedDate = String(formData.get("receivedDate") ?? "") || null;
  const kind = String(formData.get("kind") ?? "DOCUMENT") === "RECORD" ? "RECORD" : "DOCUMENT";

 if (!title) return { error: "A descriptive title is required — generic titles are non-conformant." };
 if (isEmptyTitle(title)) return { error: `“${title}” only repeats the document type. Say which one it is — what it shows, and of what.` };
 if (!deliverableType) return { error: "Deliverable type is required — it drives the numbering scheme." };
 if (!docType) return { error: "Document type is required." };
 if (!discipline) return { error: "Discipline is required — exactly one." };

  const schemeSets: Record<string, string> = {
    Subproject: "SUBPROJECTS",
    "Purchase order": "PURCHASE_ORDERS",
    Discipline: "DISCIPLINES",
    "Document type": "DOCUMENT_TYPES",
  };
  const fieldValues: Record<string, string> = {
    Subproject: subProject ?? "",
    "Purchase order": contractRef ?? "",
    Discipline: discipline,
    "Document type": docType,
  };
  for (const [label, value] of Object.entries(fieldValues)) {
    const setKey = schemeSets[label];
    if (!setKey || !value) continue;
    const active = await getActiveSet(setKey);
    if (!active.some((v) => v.code === value)) {
 return { error: `${label} “${value}” is not one of the published values. Choose one from the list, or ask an administrator to publish it.` };
    }
  }


  // What the deliverable type insists on (who it comes from, under which order) is checked by the backend, once.

  // The answers to the fields added to the form, and to the lists of one's own asked on it, kept with the document.
  // What the project's form insists on is checked by the backend, once (FIELDS_REQUIRED outlines what is missing).
  const answered = takeExtras(await ownFields(ctx, "DOCUMENT"), (name) => String(formData.get(name) ?? ""));
  // The backend allocates the number and checks every value again.
  const body = {
        title, deliverableType, docType, discipline, originator, subproject: subProject, phase, contractRef, criticality,
        confidentiality, retentionClass: chosenRetention, receivedDate, plannedDate: String(formData.get("plannedDate") ?? "") || null, kind,
        previousNumber: String(formData.get("previousId") ?? "").trim() || null,
        legacyScheme: String(formData.get("legacyScheme") ?? "").trim() || null,
        appVersion: String(formData.get("appVersion") ?? "").trim() || null,
        extras: Object.keys(answered.extras).length ? answered.extras : null,
  };
  // What came unplanned on a received transmittal, made a document: that item is registered, its files its first revision.
  const fromTransmittal = String(formData.get("fromTransmittal") ?? "");
  const fromItem = String(formData.get("fromItem") ?? "");
  if (fromTransmittal && fromItem) {
    let made: string | null = null;
    try {
      const t = await api<TransmittalView>(projectPath(ctx, `/transmittals/${fromTransmittal}/items/${fromItem}/register`), { body });
      made = t.items.find((one) => one.id === fromItem)?.documentId ?? null;
    } catch (e) {
      return refusalForForm(e);
    }
    revalidatePath(`/transmittals/${fromTransmittal}`);
    redirect(made ? `/documents/${made}?created=1` : `/transmittals/${fromTransmittal}#unplanned`);
  }
  let doc: { id: string; number: string };
  try {
    doc = await api<{ id: string; number: string }>(projectPath(ctx, "/documents"), {
      body,
      idempotencyKey: once(formData, "register"),
    });
  } catch (e) {
    return refusalForForm(e);
  }

  // Initial files create the first revision immediately: the PDF people read
  // and the editable native file, either or both.
  const files = kind === "DOCUMENT" ? filesOf(formData, "renditionFile", "nativeFile") : [];
  let filesRefused: string | null = null;
  if (files.length) {
    try {
      const fileIds = await uploadRevisionFiles(ctx, doc.id, formData);
      // The review is sent from the document's page, where the route and its people are chosen.
      await api(projectPath(ctx, `/documents/${doc.id}/revisions`), { body: { fileIds } });
    } catch (e) {
      // A file refused must not lose the register entry: the page says why, and the files are attached from it.
      filesRefused = e instanceof ApiProblem ? e.message : "The files could not be attached.";
    }
  }
  redirect(`/documents/${doc.id}?created=1${filesRefused ? `&filesRefused=${encodeURIComponent(filesRefused)}` : ""}`);
}

const EDITABLE_FIELDS = [
  "title", "docType", "discipline", "originator", "subProject", "phase", "contractRef",
  // Not the received date: it is filled when what was sent arrives, never typed.
  "criticality", "confidentiality", "retentionClass", "appVersion", "previousId", "legacyScheme",
] as const;

/** Metadata change — every change logged with field, previous value, date, person (§4.9). */
export async function updateDocumentAction(_prev: { error?: string; ok?: string } | undefined, formData: FormData): Promise<{ error?: string; ok?: string }> {
  const ctx = await requireScope();
  const id = String(formData.get("id") ?? "");
  // Only fields actually submitted — absent fields are left untouched.
  const changes: Record<string, string | null> = {};
  for (const field of EDITABLE_FIELDS) {
    if (!formData.has(field)) continue;
    const name = field === "subProject" ? "subproject" : field === "previousId" ? "previousNumber" : field;
    changes[name] = String(formData.get(field) ?? "").trim() || null;
  }
  // The answers to the form's own fields and lists of one's own, kept with the document (`extra:<key>`).
  for (const [name, value] of formData.entries()) {
    if (name.startsWith("own:") && name.length > 4) changes[`extra:${name.slice(4)}`] = String(value).trim() || null;
  }
  try {
    const before = await backendDocument(ctx, id);
    if (!before) return { error: "Document not found." };
    const current: Record<string, string | null> = {
      title: before.title, docType: before.docType, discipline: before.discipline, originator: before.originator, subproject: before.subproject, phase: before.phase ?? null,
      contractRef: before.contractRef, criticality: before.criticality, confidentiality: before.confidentiality, retentionClass: before.retentionClass,
      receivedDate: before.receivedDate, previousNumber: before.previousNumber, legacyScheme: before.legacyScheme, appVersion: before.appVersion,
    };
    for (const [key, value] of Object.entries(before.extras ?? {})) current[`extra:${key}`] = value || null;
    const changed = Object.fromEntries(Object.entries(changes).filter(([field, value]) => (current[field] ?? null) !== value));
    if (!Object.keys(changed).length) return { ok: "No changes to record." };
    await api(projectPath(ctx, `/documents/${id}`), { method: "PUT", body: { changes: changed } });
    revalidatePath(`/documents/${id}`);
    const count = Object.keys(changed).length;
    return { ok: `Saved — ${count} metadata change${count > 1 ? "s" : ""} logged.` };
  } catch (e) {
    return { error: refusal(e).message };
  }
}

/** Associate the document with the asset it describes (§5.8). */
export async function linkAssetAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const documentId = String(formData.get("documentId") ?? "");
  const assetCode = String(formData.get("assetCode") ?? "").trim();
  if (!assetCode) return { error: "Enter an asset code." };
  try {
    await api(projectPath(ctx, `/documents/${documentId}/assets`), { body: { assetCode } });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath(`/documents/${documentId}`);
  return {};
}

export async function unlinkRelationshipAction(formData: FormData) {
  const ctx = await requireScope();
  const relationshipId = String(formData.get("relationshipId") ?? "");
  await api(projectPath(ctx, `/document-assets/${relationshipId}`), { method: "DELETE" }).catch(() => null);
  revalidatePath(`/documents/${String(formData.get("documentId") ?? "")}`);
}

// End states (Part 12) — recorded with date and responsible authority (§12.1)
/** Take a cancellation or withdrawal back, with a reason. */
export async function reinstateDocumentAction(_prev: { error?: string; ok?: string } | undefined, formData: FormData): Promise<{ error?: string; ok?: string }> {
  const ctx = await requireScope();
  const documentId = String(formData.get("documentId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { error: "Say why it is reinstated." };
  try {
    await api(projectPath(ctx, `/documents/${documentId}/reinstate`), { body: { reason } });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath(`/documents/${documentId}`);
  revalidatePath("/documents");
  return { ok: "Reinstated." };
}

export async function endDocumentStateAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const documentId = String(formData.get("documentId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { error: "A reason is required — each end state is recorded with date and authority." };
  try {
    await api(projectPath(ctx, `/documents/${documentId}/end`), { body: { state: String(formData.get("kind") ?? ""), reason } });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath(`/documents/${documentId}`);
  redirect(`/documents/${documentId}`);
}

"use server";

import { redirect } from "next/navigation";
import { requireScope } from "@/lib/scope";
import { isEmptyTitle } from "@/lib/standard";
import { revalidatePath } from "next/cache";
import { mayCreateDocument } from "@/lib/auth";
import { getActiveSet, getSet } from "@/lib/config";
import { fieldRules, missingRequired, ownFields, takeExtras } from "@/lib/field-policy";
import { api, projectPath, refusal } from "@/lib/api/client";
import { backendDocument } from "@/lib/api/legacy";
import { upload, filesOf } from "@/lib/api/uploads";

// G.1 — Creating a new document. "No controlled information shall be produced
// without a register entry" (§3.9). Number is system-generated (§3.7).

export async function createDocumentAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user } = ctx;
  if (!mayCreateDocument(user)) return { error: user.isInternal ? "Read-only users cannot create documents." : "External parties cannot create register entries. Document Control must issue a placeholder to your organization first." };

  const title = String(formData.get("title") ?? "").trim();
  const deliverableType = String(formData.get("deliverableType") ?? "");
  const docType = String(formData.get("docType") ?? "");
  const discipline = String(formData.get("discipline") ?? "");
  const originator = String(formData.get("originator") ?? "") || null;
  const subProject = String(formData.get("subProject") ?? "") || null;
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
    "Supplier code": "SUPPLIER_CODES",
    "Purchase order": "PURCHASE_ORDERS",
    Discipline: "DISCIPLINES",
    "Document type": "DOCUMENT_TYPES",
  };
  const fieldValues: Record<string, string> = {
    Subproject: subProject ?? "",
    "Supplier code": originator ?? "",
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


  // C.3.3 — the published type-to-field matrix decides which conditional fields this type requires
  const matrixRows = await getSet("DELIVERABLE_TYPE_FIELDS");
  const matrix = matrixRows.find((m) => m.code === deliverableType);
  const req = (f: string): "required" | "optional" | "na" => {
    if (!matrix) return externalList().includes(deliverableType) ? (f === "originator" || f === "receivedDate" ? "required" : "optional") : "optional";
    return (matrix.props[f] as "required" | "optional" | "na") ?? "optional";
  };
  function externalList() {
    return ["CTR", "VND", "TPY", "CLT"];
  }
  const missingConditional: string[] = [];
 const enforceNow = externalList().includes(deliverableType); // supplier metadata complete at submission; internal placeholders may stay empty
  if (enforceNow && req("originator") === "required" && !originator) missingConditional.push("supplier / originator");
  if (enforceNow && req("po") === "required" && !contractRef) missingConditional.push("contract / PO");
  if (enforceNow && req("receivedDate") === "required" && !receivedDate) missingConditional.push("date received");
  if (missingConditional.length) {
 return { error: `A document from another party needs ${missingConditional.join(" and ")} before it can be registered.` };
  }

  // What this organization has said its own form insists on. The screen asks
  // for exactly these, but the screen is not the gate: an importer, a script or
  // a stale tab arrives here too.
  const asked = await fieldRules(ctx, "DOCUMENT");
  const shortOf = missingRequired(asked, "DOCUMENT", {
    subProject, originator, contractRef, receivedDate, criticality, confidentiality,
    retentionClass: chosenRetention,
    plannedDate: String(formData.get("plannedDate") ?? ""),
    assetCode: String(formData.get("assetCode") ?? ""),
    file: filesOf(formData, "renditionFile", "nativeFile").length ? "yes" : "",
    title, docType, discipline,
  });
  if (shortOf.length) {
 return { error: `This organization registers nothing without ${shortOf.join(", ")}. Fill ${shortOf.length === 1 ? "it" : "them"} in, or change what the form asks for in Settings → Forms & fields.` };
  }

  // The fields this organization added for itself. They are kept with the
  // document and computed with nowhere, so they are read last and refused for
  // one reason only: the organization said they must be filled.
  const own = await ownFields(ctx, "DOCUMENT");
  const answered = takeExtras(own, (name) => String(formData.get(name) ?? ""));
  if (answered.missing.length) {
 return { error: `${answered.missing.join(", ")} ${answered.missing.length === 1 ? "is" : "are"} asked of every document here.` };
  }
  // The backend allocates the number and checks every value again.
  let doc: { id: string; number: string };
  try {
    doc = await api<{ id: string; number: string }>(projectPath(ctx, "/documents"), {
      body: {
        title, deliverableType, docType, discipline, originator, subproject: subProject, contractRef, criticality,
        confidentiality, retentionClass: chosenRetention, receivedDate, plannedDate: String(formData.get("plannedDate") ?? "") || null, kind,
        previousNumber: String(formData.get("previousId") ?? "").trim() || null,
        legacyScheme: String(formData.get("legacyScheme") ?? "").trim() || null,
        appVersion: String(formData.get("appVersion") ?? "").trim() || null,
        extras: Object.keys(answered.extras).length ? answered.extras : null,
      },
      idempotencyKey: String(formData.get("formKey") ?? "") || undefined,
    });
  } catch (e) {
    return { error: refusal(e).message };
  }

  // Initial files create the first revision immediately: the PDF people read
  // and the editable native file, either or both.
  const files = kind === "DOCUMENT" ? filesOf(formData, "renditionFile", "nativeFile") : [];
  if (files.length) {
    try {
      const fileIds = await Promise.all(files.map((file) => upload(ctx, { documentId: doc.id }, file)));
      // The review is sent from the document's page, where the route and its people are chosen.
      await api(projectPath(ctx, `/documents/${doc.id}/revisions`), { body: { fileIds } });
    } catch {
      // file failure must not lose the register entry — the author can attach from the page
    }
  }
  redirect(`/documents/${doc.id}?created=1`);
}

const EDITABLE_FIELDS = [
  "title", "docType", "discipline", "originator", "subProject", "contractRef",
  "criticality", "confidentiality", "retentionClass", "receivedDate", "appVersion", "previousId", "legacyScheme",
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
  try {
    const before = await backendDocument(ctx, id);
    if (!before) return { error: "Document not found." };
    const current: Record<string, string | null> = {
      title: before.title, docType: before.docType, discipline: before.discipline, originator: before.originator, subproject: before.subproject,
      contractRef: before.contractRef, criticality: before.criticality, confidentiality: before.confidentiality, retentionClass: before.retentionClass,
      receivedDate: before.receivedDate, previousNumber: before.previousNumber, legacyScheme: before.legacyScheme, appVersion: before.appVersion,
    };
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

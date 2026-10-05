"use server";

import { carrierRefusal } from "@/lib/control-activities";
import { startWorkflowRun } from "@/lib/workflow";
import { redirect } from "next/navigation";
import { requireScope } from "@/lib/scope";
import { isEmptyTitle } from "@/lib/standard";
import { revalidatePath } from "next/cache";
import { isController, isAdmin, mayCreateDocument, mayContributeToDocument } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { allocateNumber } from "@/lib/numbering";
import { getActiveSet } from "@/lib/config";
import { saveUpload } from "@/lib/files";
import { isReadOnly } from "@/lib/auth";
import { retentionFor } from "@/lib/retention";
import { registerDocument } from "@/lib/register";
import { fieldRules, missingRequired, ownFields, takeExtras } from "@/lib/field-policy";

// G.1 — Creating a new document. "No controlled information shall be produced
// without a register entry" (§3.9). Number is system-generated (§3.7).

export async function createDocumentAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
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
    "Project code": "PROJECT_CODES",
    Subproject: "SUBPROJECTS",
    "Supplier code": "SUPPLIER_CODES",
    "Purchase order": "PURCHASE_ORDERS",
    Discipline: "DISCIPLINES",
    "Document type": "DOCUMENT_TYPES",
  };
  const fieldValues: Record<string, string> = {
    "Project code": String(formData.get("projectCode") ?? ""),
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
  const matrixRows = await db.configValue.findMany({ where: { setKey: "DELIVERABLE_TYPE_FIELDS" } });
  const matrix = matrixRows.find((m) => m.code === deliverableType);
  const req = (f: string): "required" | "optional" | "na" => {
    if (!matrix) return externalList().includes(deliverableType) ? (f === "originator" || f === "receivedDate" ? "required" : "optional") : "optional";
    const props = matrix.props ? (JSON.parse(matrix.props) as Record<string, string>) : {};
    return (props[f] as "required" | "optional" | "na") ?? "optional";
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
    file: (formData.get("nativeFile") as File | null)?.size ? "yes" : "",
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
  const external = req("receivedDate") !== "na";
  // The act itself lives in lib/register, so the importer and the demo seeds
  // register a document exactly as this form does.
  let doc: { id: string; docNumber: string };
  try {
    doc = await registerDocument(ctx, user, {
      title, deliverableType, docType, discipline,
      projectCode: String(formData.get("projectCode") ?? ""),
      originator, subProject, contractRef, criticality,
      confidentiality, retentionClass: chosenRetention,
      receivedDate: external && receivedDate ? new Date(receivedDate) : null,
      extras: answered.extras,
      kind,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not allocate a document number." };
  }
  const docNumber = doc.docNumber;

  // An initial file creates the first revision immediately. A PDF is the
  // viewable copy (rendition); anything else is the editable source.
  let upload = kind === "DOCUMENT" ? (formData.get("nativeFile") as File | null) : null;
  // Or a file kept with a received transmittal: the same bytes become the
  // first revision, and the transmittal then lists the document it carried.
  const fromFileId = String(formData.get("fromFileId") ?? "");
  const kept = kind === "DOCUMENT" && !(upload && upload.size > 0) && fromFileId
    ? await db.storedFile.findFirst({ where: { id: fromFileId, kind: "ATTACHMENT" }, include: { transmittal: { select: { number: true } } } })
    : null;
  if (kept) {
    const { readStored } = await import("@/lib/files");
    upload = new File([new Uint8Array(await readStored(kept.path))], kept.name, { type: kept.mime });
  }
  let sent: "yes" | "no" | string = "no";
  if (upload && upload.size > 0) {
    try {
      const isPdf = upload.type === "application/pdf" || upload.name.toLowerCase().endsWith(".pdf");
      const fileKind = isPdf ? "RENDITION" : "NATIVE";
      const saved = await saveUpload(ctx, upload, docNumber, fileKind, "A");
      const file = await db.storedFile.create({
        data: { projectId, path: saved.relPath, name: saved.name, size: saved.size, mime: saved.mime, sha256: saved.sha256, kind: fileKind, uploadedById: user.id, uploadedByName: user.name },
      });
      const rev = await db.revision.create({
        data: { projectId,
          documentId: doc.id,
          value: "A",
          series: "DESIGN",
          state: "IN_PREPARATION",
          reasonForRevision: "First issue",
          changeDescription: "Initial content",
          authoredById: user.id,
          authoredByName: user.name,
          authoredByParty: originator,
          uploadedById: user.id,
          uploadedByName: user.name,
 authorizationReason: "Placeholder register entry — authorization for the first revision.",
          authorizedById: user.id,
          authorizedByName: user.name,
          authorizedAt: new Date(),
          ...(isPdf ? { renditionFileId: file.id } : { nativeFileId: file.id }),
        },
      });
      await db.storedFile.update({ where: { id: file.id }, data: { revisionId: rev.id } });
      if (kept?.transmittalId) {
        const listed = await db.transmittalItem.findFirst({ where: { transmittalId: kept.transmittalId, revisionId: rev.id } });
        if (!listed) await db.transmittalItem.create({ data: { projectId, transmittalId: kept.transmittalId, revisionId: rev.id } });
        await audit({
          actor: user, action: "TRANSMITTAL_FILE_REGISTERED", entityType: "Transmittal", entityId: kept.transmittalId,
          entityLabel: kept.transmittal?.number ?? docNumber, detail: `${kept.name}, kept with this transmittal, registered as ${docNumber} rev A.`,
        });
      }
      await db.document.update({ where: { id: doc.id }, data: { isPlaceholder: false, appVersion: null } });
      await audit({
        actor: user,
        action: "REVISION_ESTABLISHED",
        entityType: "Revision",
        entityId: rev.id,
        entityLabel: `${docNumber} rev A`,
 detail: "First revision established with the initial file (placeholder authorization).",
      });

      // "Register & send": start the chosen review route straight away.
      const templateId = String(formData.get("sendTemplateId") ?? "");
      if (templateId) {
        const res = await startWorkflowRun(ctx, rev.id, templateId, user);
        sent = res.ok ? "yes" : res.error;
      }
    } catch {
      // file failure must not lose the register entry — the author can attach from the page
    }
  }
  const q = sent === "yes" ? "sent=1" : sent === "no" ? "created=1" : `created=1&sendError=${encodeURIComponent(sent)}`;
  redirect(`/documents/${doc.id}?${q}`);
}

const EDITABLE_FIELDS = [
  "title", "docType", "discipline", "originator", "subProject", "contractRef",
  "criticality", "confidentiality", "retentionClass", "receivedDate", "appVersion", "previousId", "legacyScheme",
] as const;

/** Metadata change — every change logged with field, previous value, date, person (§4.9). */
export async function updateDocumentAction(_prev: { error?: string; ok?: string } | undefined, formData: FormData): Promise<{ error?: string; ok?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  if (isReadOnly(user)) return { error: "Viewers cannot edit metadata." };
  const id = String(formData.get("id") ?? "");
  const doc = await db.document.findUnique({ where: { id } });
  if (!doc) return { error: "Document not found." };
  if (!mayContributeToDocument(user, doc)) return { error: "You may update only documents assigned to your organization through their originator code." };

  const changes: { field: string; oldValue: string | null; newValue: string | null }[] = [];
  const data: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (!formData.has(field)) continue; // only fields actually submitted — absent fields are left untouched
    const raw = String(formData.get(field) ?? "");
    let next: string | Date | null = raw || null;
    if (field === "receivedDate" && raw) next = new Date(raw);
    if (field === "confidentiality" && !raw) next = "INTERNAL";
    const current = (doc as unknown as Record<string, unknown>)[field];
    const currentStr = current instanceof Date ? current.toISOString().slice(0, 10) : current == null ? null : String(current);
    const nextStr = next instanceof Date ? next.toISOString().slice(0, 10) : next;
    if (currentStr !== nextStr) {
      changes.push({ field, oldValue: currentStr, newValue: nextStr });
      data[field] = next;
    }
  }
  if (!changes.length) return { ok: "No changes to record." };
  if ("title" in data && typeof data.title === "string" && isEmptyTitle(data.title)) {
 return { error: "Generic titles are non-conformant." };
  }
  await db.document.update({ where: { id }, data });
  for (const c of changes) {
    await audit({
      actor: user,
      action: "METADATA_CHANGE",
      entityType: "Document",
      entityId: id,
      entityLabel: doc.docNumber,
      field: c.field,
      oldValue: c.oldValue,
      newValue: c.newValue,
    });
  }
  revalidatePath(`/documents/${id}`);
 return { ok: `Saved — ${changes.length} metadata change${changes.length > 1 ? "s": ""} logged.` };
}

/** Associate the document with the asset it describes (§5.8, many-to-many). */
export async function linkAssetAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  const documentId = String(formData.get("documentId") ?? "");
  const assetCode = String(formData.get("assetCode") ?? "").trim();
  if (!assetCode) return { error: "Enter an asset code." };
  const asset = await db.assetItem.findFirst({ where: { code: assetCode } });
  if (!asset) return { error: `Asset "${assetCode}" is not in the asset breakdown (C.4.7).` };
  const doc = await db.document.findUnique({ where: { id: documentId } });
  if (!doc) return { error: "Document not found." };
  if (!mayContributeToDocument(user, doc)) return { error: "You may change relationships only for documents assigned to your organization." };
  const dup = await db.relationship.findFirst({ where: { kind: "DOC_ASSET", fromId: documentId, toId: asset.id } });
  if (dup) return { error: "Already associated with this asset." };
  await db.relationship.create({ data: { projectId, kind: "DOC_ASSET", fromType: "Document", fromId: documentId, toType: "AssetItem", toId: asset.id, createdById: user.id } });
  await audit({
    actor: user,
    action: "RELATIONSHIP",
    entityType: "Document",
    entityId: documentId,
    entityLabel: doc.docNumber,
 detail: `Associated with asset ${asset.code} — ${asset.name}.`,
  });
  revalidatePath(`/documents/${documentId}`);
  return {};
}

export async function unlinkRelationshipAction(formData: FormData) {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  const relId = String(formData.get("relationshipId") ?? "");
  const documentId = String(formData.get("documentId") ?? "");
  const rel = await db.relationship.findUnique({ where: { id: relId } });
  const doc = await db.document.findUnique({ where: { id: documentId } });
  if (!doc || !mayContributeToDocument(user, doc)) return;
  if (rel && rel.fromType === "Document" && rel.fromId === documentId) {
    await db.relationship.delete({ where: { id: relId } });
    await audit({ actor: user, action: "RELATIONSHIP", entityType: "Document", entityId: documentId, entityLabel: doc.docNumber, detail: `Relationship ${rel.kind} removed.` });
  }
  revalidatePath(`/documents/${documentId}`);
}

// End states (Part 12) — recorded with date and responsible authority (§12.1)
export async function endDocumentStateAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  const documentId = String(formData.get("documentId") ?? "");
  const registered = await db.document.findUnique({ where: { id: documentId }, select: { createdById: true } });
  const cannotWithdraw = await carrierRefusal(ctx, "WITHDRAW", {
    control: isController(user) || isAdmin(user),
    standing: registered?.createdById === user.id,
  });
  if (cannotWithdraw) return { error: cannotWithdraw };
  const kind = String(formData.get("kind") ?? "") as "WITHDRAWN" | "CANCELLED" | "ARCHIVED";
  const reason = String(formData.get("reason") ?? "").trim();
 if (!reason) return { error: "A reason is required — each end state is recorded with date and authority." };

  const { endDocumentState } = await import("@/lib/lifecycle");
  try {
    await endDocumentState(ctx, documentId, user, kind, reason);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not change state." };
  }
  revalidatePath(`/documents/${documentId}`);
  redirect(`/documents/${documentId}`);
}

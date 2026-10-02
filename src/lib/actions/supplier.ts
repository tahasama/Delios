"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/scope";
import { isController, isAdmin, hasVerb } from "@/lib/auth";
import { audit, notifyMany } from "@/lib/audit";
import { saveUpload } from "@/lib/files";
import { nextRevisionValue } from "@/lib/numbering";
import { executionSeriesStarted } from "@/lib/lifecycle";
import { getActiveSet } from "@/lib/config";
import { holdersOf } from "@/lib/permissions";

/**
 * A supplier package holds everything one supplier owes us: every register
 * entry whose originator is that supplier (optionally one PO). Its contents are
 * not picked by hand — a placeholder created for the supplier is in it.
 */
export async function createSupplierPackageAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId } = ctx;
  if (!isController(user) && !isAdmin(user)) return { error: "Document Control sets up supplier packages." };
  const partyCode = String(formData.get("partyCode") ?? "");
  const po = String(formData.get("po") ?? "").trim() || null;
  const dueDate = String(formData.get("dueDate") ?? "");
  const requiredStatus = String(formData.get("requiredStatus") ?? "");
  const acceptorList = formData.getAll("acceptanceAuthorityId").map(String).filter(Boolean);
  if (!partyCode) return { error: "Choose the supplier." };
  if (!dueDate) return { error: "Give the date everything is due." };
  if (!requiredStatus) return { error: "Choose the status the documents must reach." };
  if (!acceptorList.length || acceptorList.includes(user.id)) return { error: "Choose who accepts the package — someone other than you." };
  const party = await db.party.findFirst({ where: { code: partyCode } });
  if (!party) return { error: "Unknown supplier." };
  const acceptors = await db.user.findMany({ where: { id: { in: acceptorList } }, select: { id: true, name: true } });
  if (!acceptors.length) return { error: "Those people are no longer on the project." };
  const identifier = `SP-${partyCode}${po ? `-${po}` : ""}`;
  if (await db.package.findFirst({ where: { identifier } })) return { error: `${identifier} already exists.` };
  await db.package.create({
    data: {
      projectId, identifier, category: "SUPPLIER", partyCode,
      purpose: "SUPPLIER_DELIVERABLES", type: "ACCUMULATED",
      membershipRule: `Every document from ${party.name}${po ? ` under PO ${po}` : ""}`,
      recipientName: party.name, completionDate: new Date(dueDate), requiredStatus,
      compositionOwnerId: user.id, compositionOwnerName: user.name,
      acceptanceAuthorityId: acceptors[0].id, acceptanceAuthorityName: acceptors.map((one) => one.name).join(", "), acceptanceAuthorityIds: JSON.stringify(acceptors.map((one) => one.id)),
    },
  });
  await audit({ actor: user, action: "PACKAGE_CREATED", entityType: "Package", entityId: identifier, entityLabel: identifier, detail: `Supplier package for ${party.name}.` });
  redirect(`/packages/${identifier}`);
}

/**
 * The supplier sends what they uploaded. Every file becomes a revision of its
 * placeholder, and all of them travel on ONE incoming transmittal to Document
 * Control — nothing controlled arrives by email.
 */
export async function submitSupplierPackageAction(_prev: { error?: string; ok?: string } | undefined, formData: FormData): Promise<{ error?: string; ok?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId } = ctx;
  const packageId = String(formData.get("packageId") ?? "");
  const pkg = await db.package.findFirst({ where: { id: packageId, category: "SUPPLIER" } });
  if (!pkg?.partyCode) return { error: "This is not a supplier package." };
  const isStaff = isController(user) || isAdmin(user);
  if (!isStaff && user.partyCode !== pkg.partyCode) return { error: "Only this supplier can send documents in this package." };
  if (!isStaff && !supplierMayUpload(user)) return { error: "Your access here is read-only. Ask Document Control for the right to upload." };

  const docs = await db.document.findMany({ where: { originator: pkg.partyCode }, include: SUPPLIER_DOC });
  const sent: { revisionId: string; label: string }[] = [];
  for (const doc of docs) {
    const upload = formData.get(`file_${doc.id}`) as File | null;
    if (!upload || upload.size === 0) continue;
    sent.push(await attachFile(ctx, doc, upload, `package ${pkg.identifier}`));
  }
  if (!sent.length) return { error: "Attach at least one file." };
  if (user.partyCode !== pkg.partyCode) {
    // Document Control entering what the supplier sent by other means: the
    // check was done outside, so nothing waits on it — the review starts now.
    const now = new Date();
    await db.revision.updateMany({ where: { id: { in: sent.map((one) => one.revisionId) } }, data: { submittedAt: now, submittedById: user.id, submittedByName: user.name, issueDate: now } });
    const party = await db.party.findFirst({ where: { code: pkg.partyCode }, select: { name: true } });
    await audit({ actor: user, action: "SUPPLIER_FILES_ENTERED", entityType: "Package", entityId: pkg.identifier, entityLabel: pkg.identifier, detail: `Received from ${party?.name ?? pkg.partyCode} outside the system and entered by ${user.name}: ${sent.map((s) => s.label).join(", ")}.` });
    revalidatePath(`/packages/${pkg.identifier}`);
    redirect(`/reviews/send?revisions=${sent.map((one) => one.revisionId).join(",")}`);
  }
  const number = await sendRevisions(ctx, pkg.partyCode, sent, `through ${pkg.identifier}`);
  revalidatePath(`/packages/${pkg.identifier}`);
  revalidatePath("/");
  return { ok: `Sent ${sent.length} document${sent.length === 1 ? "" : "s"} on ${number}. Document Control has been notified.` };
}

/**
 * A supplier attaches its file to one of its placeholders, from the document
 * itself. Nothing is sent yet: the Send button appears once a file is there.
 */
export async function attachSupplierFileAction(_prev: { error?: string; ok?: string } | undefined, formData: FormData): Promise<{ error?: string; ok?: string }> {
  const ctx = await requireScope();
  const { user, db } = ctx;
  const documentId = String(formData.get("documentId") ?? "");
  const upload = formData.get("file") as File | null;
  const doc = await db.document.findFirst({ where: { id: documentId }, include: SUPPLIER_DOC });
  if (!doc?.originator) return { error: "This is not a supplier's document." };
  if (!mayDeliver(user, doc.originator)) return { error: user.partyCode === doc.originator ? "Your access here is read-only. Ask Document Control for the right to upload." : "Only the supplier, or Document Control for them, attaches its file." };
  if (!upload || upload.size === 0) return { error: "Choose the file." };
  await attachFile(ctx, doc, upload, "its document page");
  revalidatePath(`/documents/${doc.id}`);
  return { ok: "Attached. Send it when you are ready." };
}

/**
 * Send what was attached: one or several documents, one incoming transmittal
 * to Document Control. From a document page, or a selection in the register.
 */
export async function sendSupplierDocumentsAction(_prev: { error?: string; ok?: string } | undefined, formData: FormData): Promise<{ error?: string; ok?: string }> {
  const ctx = await requireScope();
  const { user, db } = ctx;
  const ids = [...new Set(formData.getAll("revisionId").map(String).filter(Boolean))];
  const revs = await db.revision.findMany({
    where: { id: { in: ids }, state: "IN_PREPARATION" },
    include: { document: true, transmittalItems: { include: { transmittal: true } } },
  });
  // Only what is attached and not yet on its way, or was turned back at the check.
  const ready = revs.filter((r) => (r.renditionFileId || r.nativeFileId) && (!r.submittedAt || r.transmittalItems.some((i) => i.transmittal.status === "REJECTED")));
  if (!ready.length) return { error: "Nothing chosen has a file waiting to be sent." };
  const parties = [...new Set(ready.map((r) => r.document.originator ?? ""))];
  if (parties.length !== 1 || !parties[0]) return { error: "Send one supplier's documents at a time." };
  if (!mayDeliver(user, parties[0])) return { error: "Only the supplier, or Document Control for them, sends its documents." };
  const number = await sendRevisions(ctx, parties[0], ready.map((r) => ({ revisionId: r.id, label: `${r.document.docNumber} rev ${r.value}` })), "from the register");
  for (const r of ready) revalidatePath(`/documents/${r.documentId}`);
  revalidatePath("/documents");
  return { ok: `Sent ${ready.length} document${ready.length === 1 ? "" : "s"} on ${number}.` };
}

const SUPPLIER_DOC = { revisions: { orderBy: { createdAt: "desc" as const }, include: { transmittalItems: { include: { transmittal: true } } } } };

/**
 * The supplier itself — when its function lets it upload; read-only stays
 * read-only until Document Control gives it that right — or Document Control
 * acting for one that is not on the system.
 */
function mayDeliver(user: { partyCode: string | null; role: string; verbs?: string[] }, partyCode: string): boolean {
  if (isController(user as never) || isAdmin(user as never)) return true;
  return user.partyCode === partyCode && supplierMayUpload(user);
}

function supplierMayUpload(user: unknown): boolean {
  return hasVerb(user as never, "CREATE") || hasVerb(user as never, "REVISE");
}

type SupplierDoc = {
  id: string; docNumber: string; originator: string | null; isPlaceholder: boolean;
  revisions: { id: string; value: string; state: string; submittedAt: Date | null; plannedSubmissionDate: Date | null; transmittalItems: { transmittal: { status: string } }[] }[];
};

/**
 * Put a file on the supplier's revision in hand — one turned back at the check,
 * or one not yet sent — or on a new revision. Under our number: whatever the
 * supplier calls it stays inside the file.
 */
async function attachFile(ctx: Awaited<ReturnType<typeof requireScope>>, doc: SupplierDoc, upload: File, via: string): Promise<{ revisionId: string; label: string }> {
  const { user, db, projectId } = ctx;
  const scope = await db.scopeConfig.findFirst();
  const latest = doc.revisions[0];
  const rejectedAtCheck = latest && latest.state === "IN_PREPARATION" && latest.transmittalItems.some((i) => i.transmittal.status === "REJECTED");
  const draft = latest && latest.state === "IN_PREPARATION" && !latest.submittedAt;
  let rev: { id: string; value: string } | null = rejectedAtCheck || draft ? latest : null;
  if (!rev) {
    const series = (await executionSeriesStarted(ctx, doc.id)) ? "EXECUTION" : "DESIGN";
    const value = nextRevisionValue(series as "DESIGN" | "EXECUTION", doc.revisions.map((r) => r.value), scope?.executionSeriesStart ?? 0);
    rev = await db.revision.create({
      data: {
        projectId, documentId: doc.id, value, series, state: "IN_PREPARATION",
        reasonForRevision: doc.revisions.length ? "Resubmission" : "First submission",
        // A supplier's document is authored by the supplier, whoever uploads it.
        authoredByName: doc.originator ?? "Supplier",
        authoredByParty: doc.originator ?? null,
        uploadedById: user.id,
        uploadedByName: user.name,
        changeDescription: doc.revisions.length ? "Resubmitted by the supplier" : "Initial submission",
        plannedSubmissionDate: latest?.plannedSubmissionDate ?? null,
        authorizationReason: `Supplier submission through ${via}`,
        authorizedById: user.id, authorizedByName: user.name, authorizedAt: new Date(),
      },
    });
    if (doc.isPlaceholder) await db.document.update({ where: { id: doc.id }, data: { isPlaceholder: false } });
  }
  const isPdf = upload.type === "application/pdf" || upload.name.toLowerCase().endsWith(".pdf");
  const kind = isPdf ? "RENDITION" : "NATIVE";
  const saved = await saveUpload(ctx, upload, doc.docNumber, kind, rev.value);
  const file = await db.storedFile.create({ data: { projectId, path: saved.relPath, name: saved.name, size: saved.size, mime: saved.mime, sha256: saved.sha256, kind, revisionId: rev.id, uploadedById: user.id, uploadedByName: user.name } });
  await db.revision.update({ where: { id: rev.id }, data: isPdf ? { renditionFileId: file.id } : { nativeFileId: file.id } });
  return { revisionId: rev.id, label: `${doc.docNumber} rev ${rev.value}` };
}

/** One incoming transmittal carries the submission to Document Control. */
async function sendRevisions(ctx: Awaited<ReturnType<typeof requireScope>>, partyCode: string, sent: { revisionId: string; label: string }[], via: string): Promise<string> {
  const { user, db, projectId } = ctx;
  const scope = await db.scopeConfig.findFirst();
  const now = new Date();
  await db.revision.updateMany({ where: { id: { in: sent.map((one) => one.revisionId) } }, data: { submittedAt: now, submittedById: user.id, submittedByName: user.name, issueDate: now } });
  const reasons = await getActiveSet("REASONS_FOR_ISSUE");
  const reason = reasons.find((r) => r.props.reviewCycle === true && /APPROV/i.test(r.code)) ?? reasons.find((r) => r.props.reviewCycle === true) ?? reasons[0];
  const controllers = await holdersOf(ctx, "CONTROL");
  const number = await db.$transaction(async (tx) => {
    const c = await tx.numberCounter.findUnique({ where: { projectId_prefix: { projectId, prefix: "TR" } } });
    if (c) { await tx.numberCounter.update({ where: { id: c.id }, data: { next: { increment: 1 } } }); return `TR-${String(c.next).padStart(4, "0")}`; }
    await tx.numberCounter.create({ data: { projectId, prefix: "TR", next: 2 } });
    return "TR-0001";
  });
  const party = await db.party.findFirst({ where: { code: partyCode } });
  const tr = await db.transmittal.create({
    data: {
      projectId, number, direction: "INCOMING", reasonForIssue: reason.code, dateOfIssue: now, issuingParty: party?.name ?? partyCode,
      responseRequired: true, status: "ISSUED", receivedDate: now, receivedByParty: scope?.organizationName ?? null,
      createdById: user.id, createdByName: user.name,
      items: { create: sent.map((s) => ({ projectId, revisionId: s.revisionId })) },
      recipients: { create: controllers.map((c) => ({ projectId, userId: c.id, name: c.name, organization: scope?.organizationName ?? null, notifiedAt: now })) },
    },
  });
  await audit({ actor: user, action: "TRANSMITTAL_RAISED", entityType: "Transmittal", entityId: tr.id, entityLabel: number, detail: `${user.partyCode === partyCode ? "Submitted by" : `Recorded by ${user.name} on behalf of`} ${party?.name ?? partyCode} ${via}: ${sent.map((s) => s.label).join(", ")}.` });
  await notifyMany(controllers.map((c) => c.id), "SUBMISSION_RECEIVED", `${party?.name ?? "Supplier"} sent ${sent.length} document${sent.length === 1 ? "" : "s"} (${number})`, "Check and accept, or reject with a reason.", `/transmittals/${tr.id}`);
  return number;
}

/** The register's selection, sent in one go; the register says how it went. */
export async function sendSupplierFromRegisterAction(formData: FormData): Promise<void> {
  const result = await sendSupplierDocumentsAction(undefined, formData);
  redirect(result.ok ? `/documents?sent=${encodeURIComponent(result.ok)}` : `/documents?sendError=${encodeURIComponent(result.error ?? "Nothing was sent.")}`);
}

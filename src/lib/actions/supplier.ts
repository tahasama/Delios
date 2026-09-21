"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/scope";
import { isController, isAdmin } from "@/lib/auth";
import { audit, notifyMany } from "@/lib/audit";
import { saveUpload } from "@/lib/files";
import { nextRevisionValue } from "@/lib/numbering";
import { executionSeriesStarted } from "@/lib/lifecycle";
import { getActiveSet } from "@/lib/config";

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
  const acceptorId = String(formData.get("acceptanceAuthorityId") ?? "");
  if (!partyCode) return { error: "Choose the supplier." };
  if (!dueDate) return { error: "Give the date everything is due." };
  if (!requiredStatus) return { error: "Choose the status the documents must reach." };
  if (!acceptorId || acceptorId === user.id) return { error: "Choose who accepts the package — someone other than you." };
  const party = await db.party.findFirst({ where: { code: partyCode } });
  if (!party) return { error: "Unknown supplier." };
  const acceptor = await db.user.findUniqueOrThrow({ where: { id: acceptorId } });
  const identifier = `SP-${partyCode}${po ? `-${po}` : ""}`;
  if (await db.package.findFirst({ where: { identifier } })) return { error: `${identifier} already exists.` };
  await db.package.create({
    data: {
      projectId, identifier, category: "SUPPLIER", partyCode,
      purpose: "SUPPLIER_DELIVERABLES", type: "ACCUMULATED",
      membershipRule: `Every document from ${party.name}${po ? ` under PO ${po}` : ""}`,
      recipientName: party.name, completionDate: new Date(dueDate), requiredStatus,
      compositionOwnerId: user.id, compositionOwnerName: user.name,
      acceptanceAuthorityId: acceptor.id, acceptanceAuthorityName: acceptor.name,
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

  const docs = await db.document.findMany({
    where: { originator: pkg.partyCode },
    include: { revisions: { orderBy: { createdAt: "desc" }, include: { workflowRuns: { orderBy: { createdAt: "desc" }, take: 1 }, transmittalItems: { include: { transmittal: true } } } } },
  });
  const scope = await db.scopeConfig.findFirst();
  const sent: { revisionId: string; label: string }[] = [];

  for (const doc of docs) {
    const upload = formData.get(`file_${doc.id}`) as File | null;
    if (!upload || upload.size === 0) continue;

    // Re-use a revision that was rejected at the check (never accepted), else start the next one.
    const latest = doc.revisions[0];
    const rejectedAtCheck = latest && latest.state === "IN_PREPARATION" && latest.transmittalItems.some((i) => i.transmittal.status === "REJECTED");
    const draft = latest && latest.state === "IN_PREPARATION" && !latest.submittedAt;
    let rev = rejectedAtCheck || draft ? latest : null;
    if (!rev) {
      const series = (await executionSeriesStarted(ctx, doc.id)) ? "EXECUTION" : "DESIGN";
      const value = nextRevisionValue(series as "DESIGN" | "EXECUTION", doc.revisions.map((r) => r.value), scope?.executionSeriesStart ?? 0);
      const created = await db.revision.create({
        data: {
          projectId, documentId: doc.id, value, series, state: "IN_PREPARATION",
          reasonForRevision: doc.revisions.length ? "Resubmission" : "First submission",
          changeDescription: doc.revisions.length ? "Resubmitted by the supplier" : "Initial submission",
          plannedSubmissionDate: latest?.plannedSubmissionDate ?? pkg.completionDate,
          authorizationReason: `Supplier submission through package ${pkg.identifier}`,
          authorizedById: user.id, authorizedByName: user.name, authorizedAt: new Date(),
        },
      });
      rev = { ...created, workflowRuns: [], transmittalItems: [] };
      if (doc.isPlaceholder) await db.document.update({ where: { id: doc.id }, data: { isPlaceholder: false } });
    }

    const isPdf = upload.type === "application/pdf" || upload.name.toLowerCase().endsWith(".pdf");
    const kind = isPdf ? "RENDITION" : "NATIVE";
    const saved = await saveUpload(ctx, upload, doc.docNumber, kind, rev.value);
    const file = await db.storedFile.create({ data: { projectId, path: saved.relPath, name: saved.name, size: saved.size, mime: saved.mime, sha256: saved.sha256, kind, revisionId: rev.id, uploadedById: user.id, uploadedByName: user.name } });
    await db.revision.update({
      where: { id: rev.id },
      data: { ...(isPdf ? { renditionFileId: file.id } : { nativeFileId: file.id }), submittedAt: new Date(), submittedById: user.id, submittedByName: user.name, issueDate: new Date() },
    });
    sent.push({ revisionId: rev.id, label: `${doc.docNumber} rev ${rev.value}` });
  }
  if (!sent.length) return { error: "Attach at least one file." };

  // One incoming transmittal carries the whole submission to Document Control.
  const reasons = await getActiveSet("REASONS_FOR_ISSUE");
  const reason = reasons.find((r) => r.props.reviewCycle === true && /APPROV/i.test(r.code)) ?? reasons.find((r) => r.props.reviewCycle === true) ?? reasons[0];
  const controllers = await db.user.findMany({ where: { active: true, role: { in: ["CONTROLLER", "ADMIN"] }, memberships: { some: { projectId, active: true } } } });
  const number = await db.$transaction(async (tx) => {
    const c = await tx.numberCounter.findUnique({ where: { projectId_prefix: { projectId, prefix: "TR" } } });
    if (c) { await tx.numberCounter.update({ where: { id: c.id }, data: { next: { increment: 1 } } }); return `TR-${String(c.next).padStart(4, "0")}`; }
    await tx.numberCounter.create({ data: { projectId, prefix: "TR", next: 2 } });
    return "TR-0001";
  });
  const party = await db.party.findFirst({ where: { code: pkg.partyCode } });
  const tr = await db.transmittal.create({
    data: {
      projectId, number, direction: "INCOMING", reasonForIssue: reason.code, dateOfIssue: new Date(), issuingParty: party?.name ?? pkg.partyCode,
      responseRequired: true, status: "ISSUED", receivedDate: new Date(), receivedByParty: scope?.organizationName ?? null,
      createdById: user.id, createdByName: user.name,
      items: { create: sent.map((s) => ({ projectId, revisionId: s.revisionId })) },
      recipients: { create: controllers.map((c) => ({ projectId, userId: c.id, name: c.name, organization: scope?.organizationName ?? null, notifiedAt: new Date() })) },
    },
  });
  await audit({ actor: user, action: "TRANSMITTAL_RAISED", entityType: "Transmittal", entityId: tr.id, entityLabel: number, detail: `Submitted by ${party?.name ?? pkg.partyCode} through ${pkg.identifier}: ${sent.map((s) => s.label).join(", ")}.` });
  await notifyMany(controllers.map((c) => c.id), "SUBMISSION_RECEIVED", `${party?.name ?? "Supplier"} sent ${sent.length} document${sent.length === 1 ? "" : "s"} (${number})`, "Check and accept, or reject with a reason.", `/transmittals/${tr.id}`);
  revalidatePath(`/packages/${pkg.identifier}`);
  revalidatePath("/");
  return { ok: `Sent ${sent.length} document${sent.length === 1 ? "" : "s"} on ${number}. Document Control has been notified.` };
}

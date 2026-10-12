"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/scope";
import { randomUUID } from "node:crypto";
import { isController, isAdmin, hasVerb } from "@/lib/auth";
import { supplyReason, submittedFor } from "@/lib/supplier-status";
import { api, projectPath, refusal } from "@/lib/api/client";
import { upload } from "@/lib/api/uploads";
import { backendDocument, backendRevision } from "@/lib/api/legacy";
import { addressees, packageView } from "@/lib/api/packages";
import type { PackageView, TransmittalView } from "@/lib/api/types";

/**
 * A supplier package holds everything one supplier owes us: every register
 * entry whose originator is that supplier (optionally one PO). Its contents are
 * not picked by hand — a placeholder created for the supplier is in it.
 */
export async function createSupplierPackageAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireScope();
  const { user } = ctx;
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
  const party = (await addressees(ctx)).parties.find((one) => one.code === partyCode);
  if (!party) return { error: "Unknown supplier." };
  // The backend numbers it like every package; the rule naming the supplier (and the PO) fills it.
  let number: string;
  try {
    const created = await api<PackageView>(projectPath(ctx, "/packages"), {
      body: {
        title: `${party.name}${po ? ` — ${po}` : ""}`, kind: "SUPPLY", supplierPartyId: party.id, purchaseOrder: po,
        reason: (await supplyReason()).code, requiredStatuses: [requiredStatus], completionDate: dueDate,
        ownerIds: [user.id], acceptorIds: acceptorList,
      },
      idempotencyKey: randomUUID(),
    });
    number = created.number;
  } catch (e) {
    return { error: refusal(e).message };
  }
  redirect(`/packages/${number}`);
}

/**
 * The supplier sends what they uploaded. Every file fills its placeholder, and
 * all of them travel on ONE incoming transmittal to Document Control — nothing
 * controlled arrives by email. The transmittal is the receipt.
 */
export async function submitSupplierPackageAction(_prev: { error?: string; ok?: string } | undefined, formData: FormData): Promise<{ error?: string; ok?: string }> {
  const ctx = await requireScope();
  const { user } = ctx;
  const packageId = String(formData.get("packageId") ?? "");
  const pkg = await packageView(ctx, packageId);
  const partyCode = pkg?.kind === "SUPPLY" ? pkg.rule?.originators[0] ?? user.partyCode : null;
  if (!pkg || !partyCode) return { error: "This is not a supplier package." };
  const isStaff = isController(user) || isAdmin(user);
  if (!isStaff && user.partyCode !== partyCode) return { error: "Only this supplier can send documents in this package." };
  if (!isStaff && !supplierMayUpload(user)) return { error: "Your access here is read-only. Ask Document Control for the right to upload." };

  const chosen = pkg.members
    .map((m) => ({ m, upload: formData.get(`file_${m.documentId}`) }))
    .filter((one): one is { m: typeof one.m; upload: File } => one.upload instanceof File && one.upload.size > 0);
  if (!chosen.length) return { error: "Attach at least one file." };
  // Document Control entering what the supplier sent by other means records it for them.
  const onBehalf = user.partyCode !== partyCode;
  let sent: TransmittalView;
  try {
    const status = await submittedFor(pkg.reason);
    const planned = await Promise.all(chosen.map(async ({ m, upload: file }) => ({
      documentId: m.documentId, fileIds: [await upload(ctx, { documentId: m.documentId }, file)], status,
    })));
    sent = await api<TransmittalView>(projectPath(ctx, "/transmittals/incoming"), {
      body: { reason: pkg.reason, subject: `${pkg.number}: ${planned.length} document${planned.length === 1 ? "" : "s"}`, planned, fromPartyId: onBehalf ? pkg.supplierPartyId : null },
      idempotencyKey: randomUUID(),
    });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath(`/packages/${pkg.number}`);
  revalidatePath("/");
  // Received outside the system: the review form opens next.
  if (onBehalf) redirect(`/reviews/send?revisions=${sent.items.map((one) => one.revisionId).filter(Boolean).join(",")}`);
  return { ok: `Sent ${chosen.length} document${chosen.length === 1 ? "" : "s"} on ${sent.number}. Document Control has been notified.` };
}

/**
 * A supplier attaches its file to one of its placeholders, from the document
 * itself. The backend keeps no file a supplier has not sent: attaching sends it,
 * on its own incoming transmittal.
 */
export async function attachSupplierFileAction(_prev: { error?: string; ok?: string } | undefined, formData: FormData): Promise<{ error?: string; ok?: string }> {
  const ctx = await requireScope();
  const { user } = ctx;
  const documentId = String(formData.get("documentId") ?? "");
  const file = formData.get("file");
  const doc = await backendDocument(ctx, documentId);
  if (!doc?.originator) return { error: "This is not a supplier's document." };
  if (!mayDeliver(user, doc.originator)) return { error: user.partyCode === doc.originator ? "Your access here is read-only. Ask Document Control for the right to upload." : "Only the supplier, or Document Control for them, attaches its file." };
  if (!(file instanceof File) || file.size === 0) return { error: "Choose the file." };
  try {
    const reason = await supplyReason();
    const status = await submittedFor(reason.code);
    const fromPartyId = await partyIdFor(ctx, user, doc.originator);
    const fileIds = [await upload(ctx, { documentId }, file)];
    const sent = await api<TransmittalView>(projectPath(ctx, "/transmittals/incoming"), {
      body: { reason: reason.code, planned: [{ documentId, fileIds, status }], fromPartyId },
      idempotencyKey: randomUUID(),
    });
    revalidatePath(`/documents/${documentId}`);
    return { ok: `Sent on ${sent.number}. Document Control has been notified.` };
  } catch (e) {
    return { error: refusal(e).message };
  }
}

/**
 * Send what was attached: one or several documents, one incoming transmittal
 * to Document Control. From a document page, or a selection in the register.
 */
export async function sendSupplierDocumentsAction(_prev: { error?: string; ok?: string } | undefined, formData: FormData): Promise<{ error?: string; ok?: string }> {
  const ctx = await requireScope();
  const { user } = ctx;
  const ids = [...new Set(formData.getAll("revisionId").map(String).filter(Boolean))];
  const revs = (await Promise.all(ids.map((id) => backendRevision(ctx, id).catch(() => null))))
    .filter((r): r is NonNullable<typeof r> => !!r && r.state === "IN_PREPARATION");
  const docs = await Promise.all(revs.map((r) => backendDocument(ctx, r.documentId)));
  // Only what has a file and is not yet on its way.
  const ready = revs.map((r, i) => ({ r, doc: docs[i], files: docs[i]?.revisions.find((one) => one.id === r.id)?.files.length ?? 0 }))
    .filter((one) => one.doc && one.files > 0);
  if (!ready.length) return { error: "Nothing chosen has a file waiting to be sent." };
  const parties = [...new Set(ready.map((one) => one.doc!.originator ?? ""))];
  if (parties.length !== 1 || !parties[0]) return { error: "Send one supplier's documents at a time." };
  if (!mayDeliver(user, parties[0])) return { error: "Only the supplier, or Document Control for them, sends its documents." };
  let number: string;
  try {
    const sent = await api<TransmittalView>(projectPath(ctx, "/transmittals/incoming"), {
      body: { reason: (await supplyReason()).code, revisionIds: ready.map((one) => one.r.id), fromPartyId: await partyIdFor(ctx, user, parties[0]) },
      idempotencyKey: randomUUID(),
    });
    number = sent.number;
  } catch (e) {
    return { error: refusal(e).message };
  }
  for (const one of ready) revalidatePath(`/documents/${one.r.documentId}`);
  revalidatePath("/documents");
  return { ok: `Sent ${ready.length} document${ready.length === 1 ? "" : "s"} on ${number}.` };
}

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

/** The sending organization's id when Document Control records it for them; the supplier sends as itself. */
async function partyIdFor(ctx: Awaited<ReturnType<typeof requireScope>>, user: { partyCode: string | null }, partyCode: string): Promise<string | null> {
  if (user.partyCode === partyCode) return null;
  return (await addressees(ctx)).parties.find((one) => one.code === partyCode)?.id ?? null;
}

/** The register's selection, sent in one go; the register says how it went. */
export async function sendSupplierFromRegisterAction(formData: FormData): Promise<void> {
  const result = await sendSupplierDocumentsAction(undefined, formData);
  redirect(result.ok ? `/documents?sent=${encodeURIComponent(result.ok)}` : `/documents?sendError=${encodeURIComponent(result.error ?? "Nothing was sent.")}`);
}

/**
 * Document Control sends a supplier's document we hold to the supplier for an update: they hold it from then on.
 * A revision not yet reviewed goes as it is and comes back under the same value.
 */
export async function sendToSupplierAction(_prev: { error?: string; ok?: string } | undefined, formData: FormData): Promise<{ error?: string; ok?: string }> {
  const ctx = await requireScope();
  const documentId = String(formData.get("documentId") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;
  try {
    await api(projectPath(ctx, `/documents/${documentId}/send-to-supplier`), { body: { note } });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath(`/documents/${documentId}`);
  revalidatePath("/documents");
  return { ok: "Sent to the supplier for an update." };
}

/** The side that does not hold a supplier's document asks the holder to hand it back for an update, saying why. */
export async function askBackAction(_prev: { error?: string; ok?: string } | undefined, formData: FormData): Promise<{ error?: string; ok?: string }> {
  const ctx = await requireScope();
  const documentId = String(formData.get("documentId") ?? "");
  const note = String(formData.get("reason") ?? "").trim();
  if (!note) return { error: "Say why you need it back." };
  try {
    await api(projectPath(ctx, `/documents/${documentId}/asks`), { body: { note } });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath(`/documents/${documentId}`);
  revalidatePath("/");
  return { ok: "Asked. You are told when they answer." };
}

/** The holder answers an ask to hand the document back: accepted, it passes to whoever asked; refused, with why. */
export async function answerAskAction(_prev: { error?: string; ok?: string } | undefined, formData: FormData): Promise<{ error?: string; ok?: string }> {
  const ctx = await requireScope();
  const askId = String(formData.get("askId") ?? "");
  const documentId = String(formData.get("documentId") ?? "");
  const accept = String(formData.get("accept") ?? "") === "yes";
  const answer = String(formData.get("answer") ?? "").trim() || null;
  if (!accept && !answer) return { error: "Say why it is refused." };
  try {
    await api(projectPath(ctx, `/asks/${askId}/answer`), { body: { accept, answer } });
  } catch (e) {
    return { error: refusal(e).message };
  }
  revalidatePath(`/documents/${documentId}`);
  revalidatePath("/");
  return { ok: accept ? "Handed back." : "Refused; they are told why." };
}

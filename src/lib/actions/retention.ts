"use server";

import { revalidatePath } from "next/cache";
import { requireAdminScope, requireScope } from "@/lib/scope";
import { isAdmin } from "@/lib/auth";
import type { SessionUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isController } from "@/lib/auth";

// ── §11.8 / C.8.1 Distribution rules ─────────────────────────────────────────

export async function saveDistributionRuleAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  try {
    const ctx = await requireAdminScope();
  const { user: admin, db, projectId, orgId } = ctx;
    const deliverableType = String(formData.get("deliverableType") ?? "");
    const confidentiality = String(formData.get("confidentiality") ?? "INTERNAL");
    const userIds = formData.getAll("userIds").map(String).filter(Boolean);
    const partyNames = String(formData.get("partyNames") ?? "").split("\n").map((x) => x.trim()).filter(Boolean);
    if (!deliverableType) return { error: "Choose the deliverable type." };
 if (!userIds.length && !partyNames.length) return { error: "Name at least one recipient." };
    await db.distributionRule.upsert({
      where: { projectId_deliverableType_confidentiality: { projectId, deliverableType, confidentiality } },
      update: { userIds: JSON.stringify(userIds), partyNames: JSON.stringify(partyNames) },
      create: { projectId, deliverableType, confidentiality, userIds: JSON.stringify(userIds), partyNames: partyNames.length ? JSON.stringify(partyNames) : null },
    });
 await audit({ actor: admin, action: "DISTRIBUTION_PUBLISHED", entityType: "DistributionRule", entityId: `${deliverableType}/${confidentiality}`, detail: "Distribution defined before issue, by classification and role." });
    revalidatePath("/admin/distribution");
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed." };
  }
}

export async function deleteDistributionRuleAction(formData: FormData) {
  try {
    const ctx = await requireAdminScope();
  const { user: admin, db, projectId, orgId } = ctx;
    const id = String(formData.get("id") ?? "");
    await db.distributionRule.delete({ where: { id } });
    await audit({ actor: admin, action: "DISTRIBUTION_REMOVED", entityType: "DistributionRule", entityId: id });
    revalidatePath("/admin/distribution");
  } catch {
    // ignore
  }
}

// ── §13.5 Disposal & legal hold ──────────────────────────────────────────────

export async function setLegalHoldAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  try {
    const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
    if (!isControllerOrAbove(user)) return { error: "Only the control function records legal holds (C.10.5)." };
    const documentId = String(formData.get("documentId") ?? "");
    const on = formData.get("hold") === "on";
    const doc = await db.document.findUniqueOrThrow({ where: { id: documentId } });
    await db.document.update({ where: { id: documentId }, data: { legalHold: on } });
 await audit({ actor: user, action: "LEGAL_HOLD", entityType: "Document", entityId: documentId, entityLabel: doc.docNumber, newValue: on ? "hold": "released", detail: on ? "Legal hold — disposal overridden.": "Legal hold cleared." });
    revalidatePath(`/documents/${documentId}`);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed." };
  }
}

export async function disposeDocumentAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  try {
    const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
 if (!isControllerOrAbove(user)) return { error: "Disposal is authorized by a defined authority." };
    const documentId = String(formData.get("documentId") ?? "");
    const basis = String(formData.get("basis") ?? "").trim();
    const doc = await db.document.findUniqueOrThrow({ where: { id: documentId } });
 if (doc.legalHold) return { error: "This document is under legal hold — disposal is overridden." };
 if (!basis) return { error: "Record the disposal with its retention basis and the authorizing authority." };
    await db.document.update({
      where: { id: documentId },
      data: { disposedAt: new Date(), disposedBy: user.name, disposalBasis: basis },
    });
    // the register entry is retained, marking the information as disposed (§13.5)
 await audit({ actor: user, action: "DISPOSAL", entityType: "Document", entityId: documentId, entityLabel: doc.docNumber, newValue: basis, detail: "Disposal recorded; register entry retained and marked disposed." });
    revalidatePath(`/documents/${documentId}`);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed." };
  }
}

function isControllerOrAbove(user: SessionUser) {
  return isController(user);
}

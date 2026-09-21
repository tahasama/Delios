"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/scope";
import { isAdmin, isController } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function linkControlledSourceAction(_prev: { error?: string; ok?: string } | undefined, formData: FormData): Promise<{ error?: string; ok?: string }> {
  const ctx = await requireScope();
  const { user, db, projectId, orgId } = ctx;
  if (!isController(user) && !isAdmin(user)) return { error: "Only document control can link the approved source." };
  const sourceType = String(formData.get("sourceType") ?? "");
  const sourceId = String(formData.get("sourceId") ?? "");
  const revisionId = String(formData.get("revisionId") ?? "");
  const returnPath = String(formData.get("returnPath") ?? "/");
  if (!sourceType || !sourceId || !revisionId) return { error: "Choose a controlled document revision." };
  const revision = await db.revision.findUnique({ where: { id: revisionId }, include: { document: true } });
  if (!revision) return { error: "Revision not found." };
  await db.$transaction([
    db.relationship.deleteMany({ where: { kind: "CONTROL_SOURCE", fromType: sourceType, fromId: sourceId } }),
    db.relationship.create({ data: { projectId, kind: "CONTROL_SOURCE", fromType: sourceType, fromId: sourceId, toType: "Revision", toId: revisionId, note: `${revision.document.docNumber} rev ${revision.value}`, createdById: user.id } }),
  ]);
  await audit({ actor: user, action: "CONTROL_SOURCE_LINKED", entityType: sourceType, entityId: sourceId, entityLabel: sourceType, detail: `${revision.document.docNumber} rev ${revision.value} linked as the controlled source.` });
  revalidatePath(returnPath);
  return { ok: `Linked ${revision.document.docNumber} rev ${revision.value}.` };
}

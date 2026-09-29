"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/scope";
import { audit, notify } from "@/lib/audit";
import type { Tenant } from "@/lib/scope";
import type { SessionUser } from "@/lib/auth";

/**
 * Who may read a document that is above the open confidentiality levels.
 *
 * The people who may read it are named one by one, and only by whoever is
 * answerable for the content — the person who registered it, and whoever
 * authored or uploaded a revision of it — plus an administrator, who reads
 * everything anyway. A reader's own function, however senior, names nobody.
 */

type State = { error?: string; message?: string };

/** Answerable for this document's content, so allowed to say who reads it. */
async function mayName(t: Tenant, user: SessionUser & { verbs?: string[] }, documentId: string): Promise<boolean> {
  const scope = t as Tenant & { can?: (verb: "CONFIGURE") => boolean };
  if (scope.can?.("CONFIGURE")) return true;
  const document = await t.db.document.findUnique({ where: { id: documentId }, select: { createdById: true } });
  if (!document) return false;
  if (document.createdById === user.id) return true;
  const hand = await t.db.revision.findFirst({
    where: { documentId, OR: [{ authoredById: user.id }, { uploadedById: user.id }] },
    select: { id: true },
  });
  return !!hand;
}

export async function addDocumentReaderAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  const { user, db, projectId } = ctx;
  const documentId = String(formData.get("documentId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || null;
  if (!userId) return { error: "Say who." };
  if (!(await mayName(ctx, user, documentId))) {
    return { error: "Only the person who registered this document, or whoever authored or uploaded a revision of it, says who may read it." };
  }
  const document = await db.document.findUnique({ where: { id: documentId }, select: { id: true, docNumber: true, title: true } });
  if (!document) return { error: "That document no longer exists." };
  const reader = await db.user.findFirst({ where: { id: userId, active: true }, select: { id: true, name: true } });
  if (!reader) return { error: "That person has no active account." };
  const already = await db.documentAccess.findFirst({ where: { documentId, userId }, select: { id: true } });
  if (already) return { message: `${reader.name} was already on the list.` };

  await db.documentAccess.create({
    data: { projectId, documentId, userId, addedById: user.id, addedByName: user.name, reason },
  });
  await audit({
    tenant: ctx, actor: user, action: "ACCESS_GRANTED", entityType: "Document", entityId: documentId,
    entityLabel: document.docNumber, newValue: reader.name, detail: reason ?? "Named as a reader of a closed document.",
  });
  await notify(reader.id, "ACCESS_GRANTED", `You may now read ${document.docNumber}`, document.title, `/documents/${documentId}`, ctx);
  revalidatePath(`/documents/${documentId}`);
  return { message: `${reader.name} may read it.` };
}

export async function removeDocumentReaderAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  const { user, db } = ctx;
  const id = String(formData.get("accessId") ?? "");
  const row = await db.documentAccess.findUnique({
    where: { id },
    include: { document: { select: { id: true, docNumber: true } }, user: { select: { name: true } } },
  });
  if (!row) return { error: "That person is not on the list." };
  if (!(await mayName(ctx, user, row.documentId))) {
    return { error: "Only the person who registered this document, or whoever authored or uploaded a revision of it, changes who may read it." };
  }
  await db.documentAccess.delete({ where: { id } });
  await audit({
    tenant: ctx, actor: user, action: "ACCESS_WITHDRAWN", entityType: "Document", entityId: row.documentId,
    entityLabel: row.document.docNumber, oldValue: row.user.name, detail: "Taken off the list of readers.",
  });
  revalidatePath(`/documents/${row.documentId}`);
  return { message: `${row.user.name} no longer reads it.` };
}

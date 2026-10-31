"use server";

import { revalidatePath } from "next/cache";
import { requireScope } from "@/lib/core/scope";
import { api, projectPath, refusal } from "@/lib/client";

type State = { error?: string; ok?: string };

/** A matched number taken back, with why; kept, struck through. */
export async function takeBackNumberAction(_prev: State | undefined, formData: FormData): Promise<State> {
  const ctx = await requireScope();
  const documentId = String(formData.get("documentId") ?? "");
  const id = String(formData.get("equivalentId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return { error: "Say why it is taken back." };
  try {
    await api(projectPath(ctx, `/documents/${documentId}/numbers/${id}/take-back`), { body: { reason } });
  } catch (e) {
    return { error: refusal(e).message };
  } finally {
    revalidatePath(`/documents/${documentId}`);
  }
  return { ok: "Taken back, with your reason. Their number no longer points to this document." };
}

/** Our documents a few words find (number, title, or a number of theirs matched before): for choosing one of ours, never typing it. */
export async function findOursAction(words: string): Promise<{ id: string; number: string; title: string; revision: string | null }[]> {
  const ctx = await requireScope();
  // Nothing typed yet: the register's first lines, so the list shows on a click (owner); words narrow it.
  const q = words.trim();
  const page = await api<{ items: { id: string; number: string; title: string; latestRevision: string | null }[] }>(
    projectPath(ctx, "/documents"), { query: q ? { q, limit: "30" } : { limit: "30" } }).catch(() => ({ items: [] }));
  return page.items.map((one) => ({ id: one.id, number: one.number, title: one.title, revision: one.latestRevision }));
}
